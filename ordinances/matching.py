"""
"Suggested ordinances" on the File a Report form.

The citizen's description of the violation is compared to every published
ordinance (title + category + description) using TF-IDF and cosine
similarity, and the closest matches are returned.
"""

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


def suggest_ordinances(query_text, ordinances, limit=3, min_score=0.05):
    """
    Returns up to `limit` (ordinance, score) pairs, best first, each with a
    score of at least `min_score`. Returns [] when there are fewer than 2
    ordinances or the query is empty.
    """
    ordinances = list(ordinances)
    if len(ordinances) < 2 or not query_text.strip():
        return []

    corpus = [f"{o.title} {o.category} {o.description}" for o in ordinances]
    corpus.append(query_text)  # the query is the last "document"

    try:
        matrix = TfidfVectorizer(stop_words="english").fit_transform(corpus)
    except ValueError:
        return []  # nothing left after removing stop words

    scores = cosine_similarity(matrix[-1], matrix[:-1])[0]
    ranked = sorted(zip(ordinances, scores), key=lambda pair: pair[1], reverse=True)
    return [(o, float(s)) for o, s in ranked if s >= min_score][:limit]
