Append a variable update block after the narrative in this format:
<UpdateVariable>
<JSONPatch>
[{"op":"replace","path":"/character/mood","value":"Relaxed"}]
</JSONPatch>
</UpdateVariable>
This format example does not establish a mood change. Include only fields that actually change this turn; use [] when nothing changes.
Separate path segments with /. Escape ~ and / in field names as ~0 and ~1. Use replace to update this card’s existing fields.
