Tide Lane is opening for the early morning market. Checking yesterday’s accounts, the guild bookkeeper finds a discrepancy: the registered purchases do not match the ice consumed.

Dahlia Crane has a copy of the guild’s register. The bookkeeper is willing to explain the discrepancies in person.

<initvar>
{
  "fogharbor": { "timeOfDay": "Early morning", "weather": "Light fog", "fogDensity": 25 },
  "bureau": {
    "caseFile": { "id": "WG-09", "name": "Fish market accounts", "phase": "Inspection" },
    "clues": {
      "Account ledger": { "status": "Pending", "description": "Yesterday’s payments do not match purchase quantities and ice usage; the bookkeeper retained a register copy" },
      "Dockworker shifts": { "status": "Pending", "description": "The shift roster of the dockworkers handling this shipment has not yet been obtained" }
    },
    "people": {
      "Dahlia Crane": { "stance": "Partner", "trust": 55, "notes": "Bureau recorder and partner for this assignment" },
      "Heidi": { "stance": "Neutral", "trust": 30, "notes": "Dock broker who finds loaders for shipowners" }
    },
    "evidence": {}
  },
  "investigator": { "energy": 90, "clearance": "Trainee", "renown": 20 }
}
</initvar>
