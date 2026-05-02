from enum import Enum


class Domain(str, Enum):
    AUTO = "auto"
    MEDICAL = "medical"
    HOME = "home"
    LEGAL = "legal"
    RETAIL = "retail"


class Verdict(str, Enum):
    FAIR = "fair"
    HIGH = "high"
    OVERCHARGE = "overcharge"


class Country(str, Enum):
    US = "US"


class Currency(str, Enum):
    USD = "USD"


class InputType(str, Enum):
    TEXT = "text"
    VOICE = "voice"
    IMAGE = "image"
