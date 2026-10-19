"""
"Suggested ordinances" on the File a Report form.

The citizen's description of the violation is compared to every published
ordinance (title + category + description) using TF-IDF and cosine
similarity, and the closest matches are returned.

Written in plain Python with the same results as scikit-learn's
TfidfVectorizer(stop_words="english"), so the server doesn't have to load
scikit-learn and SciPy (about 75MB of memory) in every web worker.
"""

import math
import re
from collections import Counter

from .stop_words import ENGLISH_STOP_WORDS

# Same tokenizer as scikit-learn's default: lowercase words of 2+ characters.
_TOKEN = re.compile(r"(?u)\b\w\w+\b")


def _tokens(text):
    return [t for t in _TOKEN.findall(text.lower()) if t not in ENGLISH_STOP_WORDS]


def suggest_ordinances(query_text, ordinances, limit=3, min_score=0.05):
    """
    Returns up to `limit` (ordinance, score) pairs, best first, each with a
    score of at least `min_score`. Returns [] when there are fewer than 2
    ordinances or the query is empty.
    """
    ordinances = list(ordinances)
    if len(ordinances) < 2 or not query_text.strip():
        return []

    documents = [_tokens(f"{o.title} {o.category} {o.description}") for o in ordinances]
    documents.append(_tokens(query_text))  # the query is the last "document"
    if not any(documents):
        return []  # nothing left after removing stop words

    # TF-IDF: raw term counts x smoothed idf = ln((1+n)/(1+df)) + 1, rows scaled to length 1.
    n = len(documents)
    document_frequency = Counter(term for doc in documents for term in set(doc))
    idf = {term: math.log((1 + n) / (1 + df)) + 1 for term, df in document_frequency.items()}

    def unit_vector(doc):
        weights = {term: count * idf[term] for term, count in Counter(doc).items()}
        norm = math.sqrt(sum(w * w for w in weights.values()))
        return {term: w / norm for term, w in weights.items()} if norm else {}

    # Cosine similarity of two unit vectors = their dot product.
    query = unit_vector(documents[-1])
    scores = [
        sum(weight * query.get(term, 0.0) for term, weight in unit_vector(doc).items())
        for doc in documents[:-1]
    ]
    ranked = sorted(zip(ordinances, scores), key=lambda pair: pair[1], reverse=True)
    return [(o, s) for o, s in ranked if s >= min_score][:limit]
