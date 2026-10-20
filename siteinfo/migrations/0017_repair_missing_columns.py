import importlib

from django.db import migrations
from django.db.migrations.operations.base import Operation


def _migration(name):
    return importlib.import_module(f"siteinfo.migrations.{name}")


# The data migrations that filled a column in, re-run when that column had
# to be added here, since they originally ran while it didn't exist. Each one
# only touches values still matching its own seed, so they're safe to repeat.
RESEED_IF_ADDED = {
    ("barangayprofile", "boundary"): [
        ("0004_seed_boundary", "seed"),
        ("0005_refine_boundary", "refine"),
    ],
    ("legaldocument", "sections"): [
        ("0008_legal_documents", "seed_legal_documents"),
        ("0010_add_terms_retention_sentence", "add_retention_sentence"),
        ("0012_reword_safespace_in_about_and_legal", "reword_stored_text"),
    ],
}


class AddMissingTablesAndColumns(Operation):
    """
    The live database recorded some siteinfo migrations as applied from an
    earlier, uncommitted copy of them (e.g. 0007 without footer_quick_links),
    so Django never added the columns the committed versions create, and
    every query on those tables failed with "column ... does not exist".
    Those migrations can't simply be re-run — they're already marked as
    applied — so this adds whatever table or column is missing compared to
    the models as of this point. Does nothing on a database that's complete.

    On the live database that was footer_quick_links, footer_legal_links and
    boundary on BarangayProfile, and sections on LegalDocument. The map
    outline and the Terms/Privacy text had been seeded into those columns by
    earlier data migrations, so those are re-run for any column added here
    (see RESEED_IF_ADDED).

    Each missing column is added the way AddField does it: against a model
    that doesn't have that field yet. (Passing the full model makes SQLite's
    table rebuild try to copy the not-yet-existing column from the old table.)
    """

    reversible = True
    reduces_to_sql = False

    def state_forwards(self, app_label, state):
        pass

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        connection = schema_editor.connection
        added = set()
        with connection.cursor() as cursor:
            existing_tables = set(connection.introspection.table_names(cursor))
            for (model_app, model_name), model_state in list(from_state.models.items()):
                if model_app != app_label:
                    continue
                model = from_state.apps.get_model(app_label, model_name)
                table = model._meta.db_table
                if table not in existing_tables:
                    schema_editor.create_model(model)
                    added.update((model_name, f.name) for f in model._meta.local_fields)
                    continue
                columns = {col.name for col in connection.introspection.get_table_description(cursor, table)}
                missing = [f for f in model._meta.local_fields if f.column not in columns]
                if not missing:
                    continue
                state = from_state.clone()
                for field in missing:
                    state.remove_field(app_label, model_name, field.name)
                for field in missing:
                    schema_editor.add_field(state.apps.get_model(app_label, model_name), field)
                    state.add_field(app_label, model_name, field.name, model_state.fields[field.name].clone(), True)
                    added.add((model_name, field.name))

        for column, steps in RESEED_IF_ADDED.items():
            if column in added:
                for module, function in steps:
                    getattr(_migration(module), function)(from_state.apps, schema_editor)

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        pass

    def describe(self):
        return "Add any siteinfo tables/columns missing from the database"


class Migration(migrations.Migration):

    dependencies = [
        ("siteinfo", "0016_barangayprofile_site_background"),
    ]

    operations = [
        AddMissingTablesAndColumns(),
    ]
