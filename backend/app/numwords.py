"""Numbers as spoken Persian, for reading a price back on the phone: 1250000 -> «یِک میلیون و دِویست و پَنجاه هِزار».

The words carry vowel marks so the voice says them right; they are only used for speech."""

ONES = ["", "یِک", "دو", "سه", "چَهار", "پَنج", "شِش", "هَفت", "هَشت", "نُه"]
TEENS = ["دَه", "یازدَه", "دَوازدَه", "سیزدَه", "چَهاردَه", "پانزدَه", "شانزدَه", "هِفدَه", "هِجدَه", "نوزدَه"]
TENS = ["", "", "بیست", "سی", "چِهِل", "پَنجاه", "شَصت", "هَفتاد", "هَشتاد", "نَوَد"]
HUNDREDS = ["", "صَد", "دِویست", "سیصَد", "چَهارصَد", "پانصَد", "شِشصَد", "هَفتصَد", "هَشتصَد", "نُهصَد"]
SCALES = ["", "هِزار", "میلیون", "میلیارد", "تِریلیون"]


def _under_thousand(n: int) -> str:
    parts = []
    h, rest = divmod(n, 100)
    if h:
        parts.append(HUNDREDS[h])
    if 10 <= rest < 20:
        parts.append(TEENS[rest - 10])
    else:
        t, o = divmod(rest, 10)
        if t:
            parts.append(TENS[t])
        if o:
            parts.append(ONES[o])
    return " و ".join(parts)


def to_words(n: int) -> str:
    if n == 0:
        return "صِفر"
    groups = []
    i = 0
    while n:
        n, g = divmod(n, 1000)
        if g:
            words = _under_thousand(g)
            # «هزار», not «یک هزار»
            if i == 1 and g == 1:
                words = ""
            groups.append((words + " " + SCALES[i]).strip())
        i += 1
    return " و ".join(reversed(groups))


def toman(n: int) -> str:
    return f"{to_words(n)} تومان"


if __name__ == "__main__":
    for x in (0, 7, 15, 25000, 1000, 1001, 1250000, 68332200, 480000, 2950000, 1000000000):
        print(x, "->", toman(x))
