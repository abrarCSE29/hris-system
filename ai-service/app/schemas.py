from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Priority = Literal["LOW", "MEDIUM", "HIGH", "URGENT"]


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid", str_strip_whitespace=True)


class CategoryIn(_Camel):
    code: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=1000)
    department: str = Field(min_length=1, max_length=60)  # code of the department that handles it


class DepartmentIn(_Camel):
    code: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=120)


class DraftRequest(_Camel):
    """What the backend sends. Only the message, the country and the department name ever reach the model."""

    message: str = Field(min_length=1, max_length=1000)
    requester_country: str = Field(min_length=1, max_length=60)
    requester_department: str = Field(min_length=1, max_length=120)
    categories: list[CategoryIn] = Field(min_length=1, max_length=50)
    departments: list[DepartmentIn] = Field(min_length=1, max_length=50)


class Draft(BaseModel):
    """The structured output the model must fill. Codes are checked against the lists sent, after the model."""

    title: str = Field(min_length=1, max_length=120, description="A short summary of the problem, at most 120 characters.")
    description: str = Field(
        min_length=1,
        max_length=5000,
        description="A clear write-up in the employee's own voice that keeps every fact they gave and adds nothing they did not say.",
    )
    category: str = Field(description="The code of one of the listed categories.")
    priority: Priority = Field(description="LOW, MEDIUM, HIGH or URGENT, following the priority guide.")
    department: str = Field(description="The code of one of the listed departments that should handle the request.")
    confidence: float = Field(ge=0, le=1, description="How sure you are about the category, from 0 to 1.")
    reasoning: str = Field(min_length=1, max_length=300, description="One or two sentences saying why, shown to the employee.")


class DraftResponse(_Camel):
    title: str
    description: str
    category: str
    priority: Priority
    department: str
    confidence: float
    low_confidence: bool
    reasoning: str
    model: str
    latency_ms: int
    attempts: int
