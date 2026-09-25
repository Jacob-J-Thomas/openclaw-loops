# Post-1.0 typed branching

Version 3 adds Switch and typed Condition nodes. Earlier versions retain their
existing Condition comparison rules.

A Switch resolves its value once. Cases have safe authored IDs, which are also
the stable outgoing port IDs. Ordered cases choose the first strict JSON match;
unique cases reject duplicate literal values. A Switch must provide a default
route, or declare an exhaustive boolean domain with both boolean cases. JSON
null, zero, false, empty strings, objects, arrays, and Unicode remain typed.

Typed Conditions support exists, missing, type-is, strict equals and not-equals,
numeric comparisons, and membership. Exists and missing may inspect an absent
declared binding. Every other operator raises an unavailable-binding error
instead of converting it to false. Numeric operations require numbers;
membership requires an array expected value.

The run trace records the selected port and case ID. Its observed value preview
is limited to 512 Unicode code points, while normal output and context budgets
remain in force.
