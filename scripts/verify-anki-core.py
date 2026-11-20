"""Check exported templates/searches in the real Anki backend, using a temporary collection only."""
import importlib.metadata
import json
import pathlib
import sys
import tempfile
from anki.collection import Collection

fixture = json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix="context-cards-anki-") as directory:
    col = Collection(str(pathlib.Path(directory) / "collection.anki2"))
    try:
        assert col.find_notes('note:"Context Cards Does Not Exist"') == []
        model = col.models.new("Context Cards")
        for name in fixture["fields"]:
            col.models.add_field(model, col.models.new_field(name))
        for data in fixture["templates"]:
            template = col.models.new_template(data["Name"])
            template["qfmt"], template["afmt"] = data["Front"], data["Back"]
            col.models.add_template(model, template)
        model["css"] = fixture["css"]
        col.models.add(model)
        deck = col.decks.id(fixture["deck"])
        note = col.new_note(model)
        for key, value in fixture["note"].items():
            note[key] = value
        col.add_note(note, deck)
        ids = col.find_cards(f"nid:{note.id}")
        assert len(ids) == 2, f"Expected two cards, got {len(ids)}"
        cards = sorted((col.get_card(cid) for cid in ids), key=lambda c: c.ord)
        assert all(card.did == deck for card in cards)
        assert "Show context" in cards[0].question()
        assert "brush off" in cards[0].question()
        assert "Show definition" in cards[1].question()
        assert "brushed off" not in cards[1].question()
        assert "[[type:SourceForm]]" in cards[1].question()
        assert "[[type:SourceForm]]" in cards[1].answer()
        assert "brushed off" in cards[1].answer()
        for card in cards:
            assert "phrasal verb" in card.answer()
            assert "A general definition. A broader clarification." in card.answer()
            assert fixture["note"]["AmericanIPA"] in card.answer()
            assert card.answer().count("<li>") == 5
        assert fixture["note"]["AmericanIPA"] not in cards[1].question()
        assert "A general definition." not in cards[1].question()
        assert col.find_notes(f'note:"Context Cards" Key:"{note["Key"]}"') == [note.id]
        for index, case in enumerate(fixture["cases"]):
            item = col.new_note(model)
            for key, value in fixture["note"].items():
                item[key] = value
            item["Key"] = f"test-{index}"
            item["Expression"] = case["expression"]
            col.add_note(item, deck)
            matches = col.find_notes(case["query"])
            expected = sorted([note.id, item.id]) if index == 0 else [item.id]
            assert sorted(matches) == expected, (case, matches, expected)
        legacy = col.models.new("Legacy Context Cards")
        for name in fixture["fields"]:
            if name not in ("PartOfSpeech", "AmericanIPA", "GeneralMeaning", "WordFormation"):
                col.models.add_field(legacy, col.models.new_field(name))
        for data in fixture["templates"]:
            template = col.models.new_template(data["Name"])
            template["qfmt"] = "{{Expression}}" if data["Name"] == "Recognition" else "{{GapContext}}{{type:SourceForm}}"
            template["afmt"] = "{{FrontSide}}<hr>{{Explanation}}"
            col.models.add_template(legacy, template)
        col.models.add(legacy)
        old = col.new_note(legacy)
        for key in old.keys():
            old[key] = fixture["note"][key]
        col.add_note(old, deck)
        before = [(c.id, c.did, c.queue, c.type, c.ivl, c.due) for c in old.cards()]
        for name in ("PartOfSpeech", "AmericanIPA", "GeneralMeaning", "WordFormation"):
            col.models.add_field(legacy, col.models.new_field(name))
        for template in legacy["tmpls"]:
            template["afmt"] = "{{PartOfSpeech}} {{AmericanIPA}}" + template["afmt"]
        col.models.save(legacy)
        after = [(c.id, c.did, c.queue, c.type, c.ivl, c.due) for c in col.get_note(old.id).cards()]
        assert before == after, "Metadata migration changed cards or their schedules"
        assert col.get_note(old.id)["Expression"] == fixture["note"]["Expression"]
        assert col.get_note(old.id)["Meaning"] == fixture["note"]["Meaning"]
        assert col.get_note(old.id)["GeneralMeaning"] == ""
        print(f"Anki {importlib.metadata.version('anki')}: two sibling cards, deck, both rendered templates, typed-answer markers, idempotency search and {len(fixture['cases'])} literal expression searches verified.")
    finally:
        col.close()
