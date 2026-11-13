import json

from django.core.management.base import BaseCommand

from places import nuclear


class Command(BaseCommand):
    help = 'Refresh places/data/nuclear_plants.json from OpenStreetMap (Overpass API).'

    def handle(self, *args, **options):
        plants = nuclear.fetch_plants()
        if not plants:
            self.stderr.write('Overpass returned no plants; keeping the existing snapshot.')
            return
        nuclear.SNAPSHOT.write_text(json.dumps(plants, ensure_ascii=False, indent=1), encoding='utf-8')
        nuclear.load_snapshot.cache_clear()
        self.stdout.write(self.style.SUCCESS(f'Saved {len(plants)} nuclear power plants.'))
