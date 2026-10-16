---
Variable output format:
  rule:
    - you must output the update analysis and the actual update commands at once in the end of the next reply
    - the update commands works like the **JSON Patch (RFC 6902)** standard, must be a valid JSON array containing operation objects, but supports the following operations instead:
    - replace: replace the value of existing paths
    - delta: update the value of existing number paths by a delta value
    - insert: insert new items into an object or array; the array index written as - appends to the end
    - remove
    - move: move the content of from to to
    - every operation except move needs path; move needs from and to; a wrong op name is silently ignored instead of raising an error
    - paths start from the root of stat_data, so never write the stat_data. prefix; write ~0 and ~1 for ~ and / inside a field name
    - "${...} only marks a placeholder: replace it with a legal JSON value (strings in quotes, the delta value a bare number like 1, [] when nothing changed)"
    - don't update field names starts with _ as they are readonly, such as _variables
  format: |-
    <UpdateVariable>
    <Analysis>$(IN ENGLISH, no more than 80 words)
    - ${calculate time passed: ...}
    - ${decide whether dramatic updates are allowed as it's in a special case or the time passed is more than usual: yes/no}
    - ${analyze every variable based on its corresponding check, according only to current reply instead of previous plots: ...}
    </Analysis>
    <JSONPatch>
    [
      { "op": "replace", "path": "${/path/to/variable}", "value": "${new_value}" },
      { "op": "delta", "path": "${/path/to/number/variable}", "value": 1 },
      { "op": "insert", "path": "${/path/to/object/new_key}", "value": "${new_value}" },
      { "op": "insert", "path": "${/path/to/array/-}", "value": "${new_value}" },
      { "op": "remove", "path": "${/path/to/object/key}" },
      { "op": "move", "from": "${/path/to/variable}", "to": "${/path/to/another/path}" }
    ]
    </JSONPatch>
    </UpdateVariable>
