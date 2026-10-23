"""Persian text helpers: digits, full-text query building, place names."""
import re

FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_TO_LATIN = {ord(c): str(i) for i, c in enumerate(FA_DIGITS)} | {ord(c): str(i) for i, c in enumerate(AR_DIGITS)}
_TO_FA = {ord(str(i)): c for i, c in enumerate(FA_DIGITS)}

# Lucene reserved characters, escaped before building a query
_LUCENE_SPECIAL = re.compile(r'([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)')

# Big Iranian cities, so a city name in the search box is never offered as a product.
CITIES = [
    "تهران", "مشهد", "اصفهان", "کرج", "شیراز", "تبریز", "قم", "اهواز", "کرمانشاه", "ارومیه",
    "رشت", "زاهدان", "همدان", "کرمان", "یزد", "اردبیل", "بندرعباس", "اراک", "زنجان", "سنندج",
    "قزوین", "خرم‌آباد", "گرگان", "ساری", "بابل", "آمل", "کاشان", "شهریار", "اسلامشهر", "ورامین",
    "پردیس", "دزفول", "آبادان", "بوشهر", "بیرجند", "سبزوار", "نیشابور", "سمنان", "یاسوج", "ایلام",
]


def to_latin_digits(s: str) -> str:
    return s.translate(_TO_LATIN)


def to_fa_digits(s: str) -> str:
    return s.translate(_TO_FA)


def normalize(s: str) -> str:
    s = s.replace("ي", "ی").replace("ك", "ک").replace("‌", " ")
    return re.sub(r"\s+", " ", s).strip()


def tokens(s: str) -> list[str]:
    return [t for t in normalize(s).split(" ") if t]


def _escape(t: str) -> str:
    return _LUCENE_SPECIAL.sub(r"\\\1", t)


# Titles mostly use Latin brand and model names; map common Persian spellings to them.
SYNONYMS = {
    "آیفون": ["iPhone"], "ایفون": ["iPhone"], "اپل": ["Apple"], "سامسونگ": ["Samsung"], "گلکسی": ["Galaxy"],
    "شیائومی": ["Xiaomi"], "شیاومی": ["Xiaomi", "شیائومی"], "ردمی": ["Redmi"], "پوکو": ["Poco"], "نوت": ["Note"],
    "هواوی": ["Huawei"], "آنر": ["Honor"], "نوکیا": ["Nokia"], "ریلمی": ["Realme"], "موتورولا": ["Motorola"],
    "پیکسل": ["Pixel"], "داریا": ["Daria"], "باند": ["Bond"], "ایرپاد": ["AirPods"], "ایرپادز": ["AirPods"],
    "مک‌بوک": ["MacBook"], "مکبوک": ["MacBook"], "آیپد": ["iPad"], "ایپد": ["iPad"], "پرو": ["Pro"],
    "مکس": ["Max"], "پلاس": ["Plus"], "لایت": ["Lite"], "اولترا": ["Ultra"], "مینی": ["mini"],
    "لنوو": ["Lenovo"], "ایسوس": ["Asus"], "اچ‌پی": ["HP"], "دل": ["Dell"], "سونی": ["Sony"], "ال‌جی": ["LG"],
}


# Series and filler words shops often leave out ("گوشی سامسونگ A26" has no "Galaxy"):
# they help the score but are not required when the query has other words.
OPTIONAL_WORDS = {"گلکسی", "galaxy", "مدل", "موبایل", "model"}


def fulltext_query(q: str, prefix_last: bool = True) -> str:
    """Every word required (except series/filler words); digits match both Persian and Latin forms; the last word may be a prefix."""
    parts = []
    words = tokens(q)
    has_core = any(w.lower() not in OPTIONAL_WORDS for w in words)
    for i, w in enumerate(words):
        latin, fa = to_latin_digits(w), to_fa_digits(to_latin_digits(w))
        forms = {_escape(latin), _escape(fa)} | {_escape(s) for s in SYNONYMS.get(w, [])}
        if prefix_last and i == len(words) - 1 and len(w) >= 2:
            forms |= {f + "*" for f in list(forms)}
        sign = "" if has_core and w.lower() in OPTIONAL_WORDS else "+"
        parts.append(sign + "(" + " OR ".join(sorted(forms)) + ")" if len(forms) > 1 else sign + forms.pop())
    return " ".join(parts)


def is_stock(title: str) -> bool:
    return any(k in title for k in ("استوک", "کارکرده", "دست دوم", "اوپن باکس"))


def is_lookalike(title: str) -> bool:
    return "طرح " in title
