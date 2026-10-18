#!/usr/bin/env bash
set -o errexit

pip install -r requirements.txt

# Only the headless OpenCV build should be present (reports/pdf.py uses cv2
# for video thumbnails; the full opencv-python needs a system libGL that hosts
# like Render don't have). Older builds pulled in the full package via the
# since-removed OCR dependency, so it's cleared out in case a cached build
# still has it — both share the same cv2/ directory, hence the
# uninstall-then-force-reinstall.
pip uninstall -y opencv-python
pip install --force-reinstall --no-deps opencv-python-headless==5.0.0.93

python manage.py collectstatic --noinput
python manage.py migrate
