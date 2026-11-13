#!/usr/bin/env bash
# Render build step: build the Angular app, then prepare Django to serve it.
set -o errexit

(cd frontend && npm ci --legacy-peer-deps && npm run build -- --configuration production)

cd backend
pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate --no-input
