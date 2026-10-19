import math
import re
from collections import Counter

from .stop_words import ENGLISH_STOP_WORDS

# Same tokenizer as scikit-learn's TfidfVectorizer default: lowercase words of
# 2+ word characters.
_TOKEN = re.compile(r"(?u)\b\w\w+\b")


def _tokens(text):
    return [t for t in _TOKEN.findall(text.lower()) if t not in ENGLISH_STOP_WORDS]


def suggest_ordinances(query_text, ordinances, limit=3, min_score=0.05):
    """
    Ranks `ordinances` by TF-IDF cosine similarity against `query_text`,
    treating the query as one more "document" in the same vector space as
    the ordinance corpus (title + category + description) — the standard
    vector-space-model approach to query/document similarity.

    Returns a list of (ordinance, score) tuples, highest score first,
    length <= limit, each score >= min_score. Returns [] if there are
    fewer than 2 ordinances (TF-IDF's idf term is degenerate with 0-1
    documents) or if nothing clears min_score.

    Plain Python reproducing TfidfVectorizer(stop_words="english")'s defaults
    exactly (raw term counts, smoothed idf = ln((1+n)/(1+df)) + 1, L2-normalised
    rows) instead of importing scikit-learn: it and SciPy cost ~75MB in every
    web worker, which a 512MB Render instance can't spare alongside the OCR
    prefill. The corpus is barangay-scale (tens of ordinances), so this is
    still a few milliseconds per request — no caching, so no stale-cache-
    after-edit bugs.
    """
    ordinances = list(ordinances)
    if len(ordinances) < 2 or not query_text.strip():
        return []

    documents = [_tokens(f"{o.title} {o.category} {o.description}") for o in ordinances]
    documents.append(_tokens(query_text))
    if not any(documents):
        # Empty vocabulary after stopword removal (e.g. all stopwords/punctuation).
        return []

    n = len(documents)
    document_frequency = Counter(term for doc in documents for term in set(doc))
    idf = {term: math.log((1 + n) / (1 + df)) + 1 for term, df in document_frequency.items()}

    def unit_vector(doc):
        weights = {term: count * idf[term] for term, count in Counter(doc).items()}
        norm = math.sqrt(sum(w * w for w in weights.values()))
        return {term: w / norm for term, w in weights.items()} if norm else {}

    query = unit_vector(documents[-1])
    scores = [
        sum(weight * query.get(term, 0.0) for term, weight in unit_vector(doc).items())
        for doc in documents[:-1]
    ]
    ranked = sorted(zip(ordinances, scores), key=lambda pair: pair[1], reverse=True)
    return [(o, s) for o, s in ranked if s >= min_score][:limit]
