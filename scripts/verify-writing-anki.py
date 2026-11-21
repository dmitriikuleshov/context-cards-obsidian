"""Render both writing formats in a disposable real Anki collection."""
import json
import sys
import tempfile
from pathlib import Path
from anki.collection import Collection

fixture = json.load(sys.stdin)
with tempfile.TemporaryDirectory() as temp:
    col = Collection(str(Path(temp) / 'writing.anki2'))
    try:
        model = col.models.new('Context Cards Writing')
        for field in fixture['fields']:
            col.models.add_field(model, col.models.new_field(field))
        template = col.models.new_template('Practice')
        template['qfmt'] = fixture['template']['Front']
        template['afmt'] = fixture['template']['Back']
        col.models.add_template(model, template)
        model['css'] = fixture['css']
        col.models.add(model)
        deck = col.decks.id('English::Writing mistakes')
        for index, fields in enumerate(fixture['notes']):
            note = col.new_note(model)
            for name, value in fields.items():
                note[name] = value
            col.add_note(note, deck)
            cards = col.find_cards(f'nid:{note.id}')
            assert len(cards) == 1, 'Each writing finding must create exactly one card'
            card = col.get_card(cards[0])
            front, back = card.question(), card.answer()
            assert 'I have written three stories.' in back
            assert 'Use a participle.' in back
            assert 'obsidian://open' in back
            if index == 0:
                assert '<mark>wrote</mark>' in front
                assert '[[type:Answer]]' not in front
            else:
                assert 'cc-gap' in front
                assert '[[type:Answer]]' in front
                assert 'written' not in front
            query = f'note:"Context Cards Writing" (Key:"{note["Key"]}" or PatternKey:"{note["PatternKey"]}")'
            assert note.id in col.find_notes(query)
        print('Writing Anki verified: one card per note, correction/gap fronts, typed answers, source links and lookup queries.')
    finally:
        col.close()
