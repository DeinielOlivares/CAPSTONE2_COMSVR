# CAPSTONE2_COMSVR

**Web-Based Community Ordinance Management System and Violations Reporting for the City of Biñan
Using Modified Blowfish Data Protection Algorithm** (Barangay Platero OVRMS).

* **[SYSTEM_GUIDE.md](./SYSTEM_GUIDE.md)** — how the whole system works: every folder, file,
  endpoint, database table, security feature and main flow, plus what changed in the refactor.
  Start here.
* **[CONTRIBUTING.md](./CONTRIBUTING.md)** — setting up a development copy (SQLite or PostgreSQL)
  and how the team works with Git without breaking the live site.

Quick start:

```bash
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # fill in SECRET_KEY and DATA_ENCRYPTION_KEY
python manage.py migrate
python manage.py runserver  # http://127.0.0.1:8000/
python manage.py test       # run the automated tests
```
