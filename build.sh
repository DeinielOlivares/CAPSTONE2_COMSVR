#!/usr/bin/env bash
# Render build script: install packages, collect static files, update the database.
set -o errexit

pip install -r requirements.txt
python manage.py collectstatic --noinput
python manage.py migrate
