"""Identifies an animal track or a plant from a photo with Google Gemini's vision, and reports what is known about it."""
import json
import os

from google import genai
from google.genai import errors, types

# Tried in order; GEMINI_MODEL overrides. A model that Google has retired answers 404, so the next one is tried.
MODELS = ('gemini-3.6-flash', 'gemini-2.5-flash')
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MEDIA_TYPES = ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
KINDS = ('track', 'plant')
NOT_SET_UP = 'Photo identification is not set up. Set GOOGLE_MAPS_API_KEY (or GEMINI_API_KEY) for the Arsenal backend and restart it.'


class IdentifyError(Exception):
    """Identification could not be completed. `status` is the HTTP status to answer with."""

    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


SYSTEM_PROMPT = """\
You are the identification feature of Arsenal, an outdoor map app. A person in the field sends one photo of either \
an animal track (footprint) or a plant, berry or fungus, and reads your answer on their phone to decide what to do \
next. They are not an expert, and a wrong answer about eating something can poison them, so being honest about \
uncertainty matters more than giving a confident name.

Identify what the photo shows and give the most plausible candidates, most likely first, at most four. For each one \
explain the visible features that point to it (for tracks: number of toes, claw marks, pad shape, size if anything \
in the photo gives scale; for plants: leaf shape and arrangement, berry colour and clustering, stem, flowers) and say \
what in the photo would distinguish it from the other candidates. If an approximate location is given, use it to \
judge which species actually live there.

For plants, berries and fungi:
- A photo is never enough to confirm that something is safe to eat. Use "edible" or "edible_with_preparation" only \
to report that the species, when correctly identified, is known to be eaten, and always name the dangerous \
look-alikes it can be confused with.
- If any plausible candidate is poisonous, say so plainly in safety_warning and advise not eating it.
- medicinal_uses reports traditional or documented uses as information, not as medical advice; say when evidence is \
weak, and do not give doses.

For animal tracks, dangerous_to_humans says how dangerous the animal is to a person on foot and what to do if it is \
nearby. Use "not_applicable" for edibility and leave toxicity, medicinal_uses and lookalikes as empty strings.

If the photo does not clearly show a track or a plant, or is too blurry, dark or distant to judge, set subject to \
"unclear", return no candidates, and use photo_tips to say exactly how to retake it (for example: include a coin or \
hand for scale, shoot straight down, photograph the leaves and the berries separately).

Write plainly and briefly; every field is shown as-is on a small screen."""

_CANDIDATE = {
    'type': 'object',
    'properties': {
        'common_name': {'type': 'string'},
        'scientific_name': {'type': 'string'},
        'likelihood': {'type': 'string', 'enum': ['likely', 'possible', 'unlikely']},
        'reasoning': {'type': 'string', 'description': 'Visible features that support this identification.'},
        'dangerous_to_humans': {'type': 'string', 'description': 'For animals: the risk to a person and what to do.'},
        'edibility': {
            'type': 'string',
            'enum': ['edible', 'edible_with_preparation', 'not_edible', 'poisonous', 'unknown', 'not_applicable'],
        },
        'toxicity': {'type': 'string', 'description': 'Which parts are toxic and the symptoms, or empty.'},
        'medicinal_uses': {'type': 'string', 'description': 'Traditional or documented uses, or empty.'},
        'lookalikes': {'type': 'string', 'description': 'Species it is commonly confused with, or empty.'},
    },
    'required': [
        'common_name', 'scientific_name', 'likelihood', 'reasoning', 'dangerous_to_humans',
        'edibility', 'toxicity', 'medicinal_uses', 'lookalikes',
    ],
}

RESULT_SCHEMA = {
    'type': 'object',
    'properties': {
        'subject': {'type': 'string', 'enum': ['animal_track', 'plant', 'fungus', 'other', 'unclear']},
        'summary': {'type': 'string', 'description': 'One or two sentences with the overall answer.'},
        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
        'candidates': {'type': 'array', 'items': _CANDIDATE},
        'safety_warning': {'type': 'string', 'description': 'What the person must not do based on this photo.'},
        'photo_tips': {'type': 'string', 'description': 'How a better photo would improve the answer, or empty.'},
    },
    'required': ['subject', 'summary', 'confidence', 'candidates', 'safety_warning', 'photo_tips'],
}

_QUESTIONS = {
    'track': 'This is a photo of an animal track. Which animal could have made it?',
    'plant': 'This is a photo of a plant, berry or fungus. What is it, and is it edible, poisonous or medicinal?',
}


def identify(image_bytes, media_type, kind, location=None):
    """Returns the structured identification as a dict, or raises IdentifyError."""
    question = _QUESTIONS[kind]
    if location:
        # Rounded to about 10 km: enough to know the region's species without sending an exact position.
        question += f' The photo was taken near latitude {location[0]:.1f}, longitude {location[1]:.1f}.'
    contents = [types.Part.from_bytes(data=image_bytes, mime_type=media_type), question]
    return generate_json(SYSTEM_PROMPT, contents, RESULT_SCHEMA)


def generate_json(system, contents, schema):
    """Asks Gemini for an answer matching `schema` and returns it as a dict, or raises IdentifyError."""
    # GEMINI_API_KEY wins; otherwise the Google Maps key is reused (the Generative Language API must be enabled on it).
    api_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_MAPS_API_KEY')
    if not api_key:
        raise IdentifyError(NOT_SET_UP, 503)

    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=120_000))
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type='application/json',
        response_json_schema=schema,
        max_output_tokens=16000,
    )
    models = (os.environ['GEMINI_MODEL'],) if os.environ.get('GEMINI_MODEL') else MODELS
    response = None
    for index, model in enumerate(models):
        try:
            response = client.models.generate_content(model=model, contents=contents, config=config)
            break
        except errors.ClientError as error:
            if error.code == 404 and index < len(models) - 1:
                continue
            if error.code in (400, 401, 403) and 'API key' in str(error):
                raise IdentifyError('The Gemini API key was rejected. Check GEMINI_API_KEY.', 503) from error
            if error.code == 429:
                raise IdentifyError('Too many identification requests. Wait a moment and try again.', 429) from error
            if error.code == 403:
                reason = str(getattr(error, 'message', '') or error)[:300]
                raise IdentifyError(
                    f'Google refused the request (403): {reason} '
                    'Enable the Generative Language API for the project that owns the key, and allow it on the key.',
                    503,
                ) from error
            raise IdentifyError(f'The identification service returned an error ({error.code}).', 502) from error
        except errors.ServerError as error:
            raise IdentifyError(f'The identification service returned an error ({error.code}).', 502) from error
        except errors.APIError as error:
            raise IdentifyError(f'The identification service returned an error ({error.code}).', 502) from error
        except Exception as error:  # network failures surface as httpx errors
            raise IdentifyError('Could not reach the identification service. Check the connection.', 502) from error

    feedback = response.prompt_feedback
    if feedback and feedback.block_reason:
        raise IdentifyError('This photo could not be analysed. Try a different photo.', 422)
    candidate = response.candidates[0] if response.candidates else None
    reason = candidate.finish_reason.name if candidate and candidate.finish_reason else 'STOP'
    if reason == 'MAX_TOKENS':
        raise IdentifyError('The identification was cut short. Try again.', 502)
    if reason not in ('STOP', 'FINISH_REASON_UNSPECIFIED'):
        raise IdentifyError('This photo could not be analysed. Try a different photo.', 422)

    try:
        return json.loads(response.text)
    except (TypeError, ValueError) as error:
        raise IdentifyError('The identification service gave an unreadable answer. Try again.', 502) from error
