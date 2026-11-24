import json, hashlib, html, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'experiments/writing-expanded-2026-11-23'
ART = ROOT / '.test-artifacts'
SYSTEMS, FORMATS = {}, {}

def read(p):
    return json.loads(p.read_text(encoding='utf-8-sig'))

def write(name, data):
    (OUT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

def pooled(value, pool):
    key = hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    pool[key] = value
    return key

def score(row, case):
    row = dict(row)
    actual = row.get('actual', [])
    plans = [case['expected']] + case.get('alternativeExpected', [])
    plan = min(plans, key=lambda p: sum(s not in actual for s in p) + sum(s not in p for s in actual))
    row.update(matchedExpected=plan, missing=[s for s in plan if s not in actual], extra=[s for s in actual if s not in plan])
    row['pass'] = not row['missing'] and not row['extra'] and not row.get('error')
    row['group'] = case.get('group', 'holdout' if case['id'].startswith('hold-') else 'previous-basic')
    row['diagnosticOnly'] = case.get('diagnosticOnly', False)
    return row

def archive(label, folder_name, gold, replay=False):
    folder = ART / folder_name
    original = read(folder / 'results.json')
    rows = read(folder / 'replay-results.json')['results'] if replay else original
    assert len(rows) == len(gold) * 4 and len({(r['id'], r['model']) for r in rows}) == len(rows)
    cases = {c['id']: c for c in gold}
    rows = [score(r, cases[r['id']]) for r in rows]
    write(label + '-raw-results.json', original)
    write(label + '-results.json', rows)
    write(label + '-run.json', read(folder / 'run.json'))
    write(label + '-original-cases.json', read(folder / 'cases.json'))
    traces = []
    live = cached = 0
    for line in (folder / 'transport.jsonl').read_text().splitlines():
        trace = json.loads(line)
        cached += bool(trace.get('cacheSource'))
        live += not bool(trace.get('cacheSource'))
        req = trace.pop('request')
        messages, schema = req.pop('messages'), req.pop('format')
        trace.update(params=req, system=pooled(messages[0]['content'], SYSTEMS),
                     format=pooled(schema, FORMATS), input=messages[1]['content'])
        traces.append(json.dumps(trace, ensure_ascii=False))
    (OUT / (label + '-trace.jsonl')).write_text('\n'.join(traces) + '\n', encoding='utf-8')
    protocol = dict(records=len(rows), model_calls=len(traces), live_calls=live, cached_calls=cached)
    if replay:
        protocol['exact_payload_replay'] = read(folder / 'replay-results.json')['payloadsMatched']
    return rows, protocol

def stats(rows):
    return dict(cases=len(rows), passed=sum(r['pass'] for r in rows), errors=sum(bool(r.get('error')) for r in rows),
                missing=sum(len(r['missing']) for r in rows), extra=sum(len(r['extra']) for r in rows),
                exercises=sum(len(r.get('cards', [])) for r in rows))

cases = read(OUT / 'cases.json')
holdout = read(OUT / 'holdout.json')
format_cases = read(ART / 'writing-expanded-format-confirmed/cases.json')
write('format-cases.json', format_cases)
baseline, bp = archive('baseline', 'writing-expanded-baseline-v2', cases)
final, fp = archive('final', 'writing-expanded-verified', cases, True)
held, hp = archive('holdout', 'writing-expanded-holdout-verified', holdout, True)
formatted, mp = archive('format', 'writing-expanded-format-confirmed', format_cases)
write('request-systems.json', SYSTEMS)
write('request-formats.json', FORMATS)
write('model-metadata.json', read(ART / 'writing-model-metadata.json'))
# Immutable baseline client and final client used for the format checks. Final main
# and holdout results are additionally verified against the production source by replay.
shutil.copyfile(ART / 'writing-expanded-baseline-v2/client.mjs', OUT / 'baseline-client.mjs')
shutil.copyfile(ART / 'writing-expanded-format-confirmed/client.mjs', OUT / 'final-client.mjs')
models = []
for model in ['gemma3:12b-it-q4_K_M','gemma4:12b-it-qat','qwen3:14b-q4_K_M','qwen3.5:9b-q4_K_M']:
    b = [r for r in baseline if r['model'] == model and not r['diagnosticOnly']]
    f = [r for r in final if r['model'] == model and not r['diagnosticOnly']]
    prior = {r['id']: r for r in b}
    models.append(dict(model=model, before=stats(b), after=stats(f),
        improved=sum(r['pass'] and not prior[r['id']]['pass'] for r in f),
        regressed=sum(not r['pass'] and prior[r['id']]['pass'] for r in f),
        new_holdout=stats([r for r in held if r['model']==model and r['id'].startswith('hold-')]),
        previous_basic=stats([r for r in held if r['model']==model and r['id'].startswith('regression-')]),
        marked_text=stats([r for r in formatted if r['model']==model]),
        groups=[dict(group=g, before=stats([r for r in b if r['group']==g]), after=stats([r for r in f if r['group']==g])) for g in sorted({r['group'] for r in f})]))
scored_final = [r for r in final if not r['diagnosticOnly']]
summary = dict(version='0.3.37', date='2026-11-23', baseline_commit='5ab8498', code_commit='19ec138', models=models,
    main_before=stats([r for r in baseline if not r['diagnosticOnly']]), main_after=stats(scored_final),
    holdout=stats(held), formatting=stats(formatted), all_final_scored=stats(scored_final+held+formatted),
    diagnostics=[r for r in final if r['diagnosticOnly']],
    failures=[r for r in scored_final+held+formatted if not r['pass']],
    protocol=dict(baseline=bp, final=fp, holdout=hp, formatting=mp,
        comparison='Same 95 automatically scored expanded passages per model. One ambiguous recommend construction is diagnostic only. All adjudicated gold alternatives and errata are applied equally to both versions.',
        cache='Final verification mixes live inference and exact full-request response reuse. Changed prompts, input, schema or model tags require live inference. Cached results are not independent stochastic replications and timings are not speed comparisons.',
        original_holdout='All 40 holdout passages per model were inferred live in writing-expanded-holdout before exact-payload final verification. This includes 16 new contrastive passages and the 24 previous basic regressions.',
        score='A case passes only if all expected local one-target corrections occur with no extras or request failure. Equivalent anchors are scored by the resulting original source sentence. This does not grade every explanation, hint or taxonomy label.',
        runtime=dict(think=False, temperature=0, num_ctx=6144, num_predict=3200, timeout_seconds=300, sequence='One model at a time; other models unloaded.'),
        no_external_writes='Synthetic passages only. No Anki notes or vault content/settings changed by the audits.'),
    manual_feedback_limit=dict(model='gemma3:12b-it-q4_K_M', case='hold-none-mass',
        observation='The correction equipment are -> equipment is is right, but the explanation incorrectly calls equipment plural and gives an overgeneralized rule about none. Thus exact-edit success is not proof of pedagogically correct explanations.'),
    validation=dict(unit_tests=765, analysis_tests=355, ui_tests=57, generated_exercises=stats(final+held)['exercises']))
write('summary.json', summary)

def esc(s):return html.escape(str(s))
table = ''.join('<tr>'+''.join('<td>'+esc(x)+'</td>' for x in [m['model'],str(m['before']['passed'])+'/95',str(m['after']['passed'])+'/95','+'+str(m['improved']),m['regressed'],str(m['new_holdout']['passed'])+'/16',str(m['previous_basic']['passed'])+'/24',str(m['marked_text']['passed'])+'/3'])+'</tr>' for m in models)
failures = ''
all_cases = {c['id']: c for c in cases+holdout+format_cases}
for r in summary['failures']:
    failures += '<details><summary>'+esc(r['model']+' / '+r['id'])+'</summary><p><b>Source:</b> '+esc(all_cases[r['id']]['text'])+'</p><p><b>Returned local corrections:</b></p><pre>'+esc(json.dumps(r.get('actual'),ensure_ascii=False,indent=2))+'</pre><p><b>Missing:</b> '+esc(r['missing'])+'<br><b>Extra:</b> '+esc(r['extra'])+'</p></details>'
report = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Find mistakes — expanded four-model audit</title><style>
:root{color-scheme:dark}body{font:16px/1.65 system-ui;max-width:1150px;margin:auto;padding:30px;background:#171b18;color:#e5ece6}h1,h2{line-height:1.25}h2{margin-top:38px}a{color:#bfdcaa}th,td{text-align:left;padding:12px;border-bottom:1px solid #435045;white-space:nowrap}table{border-collapse:collapse;width:100%;font-size:14px}th{color:#bfdcaa}.scroll{overflow-x:auto}p{max-width:970px}details{padding:15px 0;border-bottom:1px solid #354138}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#222a24;padding:14px;border-radius:9px}.muted{color:#b1bcb2}code{color:#bfdcaa}</style>
<h1>Find mistakes: expanded four-model audit</h1><p>Context Cards 0.3.37 · 23 November 2026 · RTX 5070 12 GB · Ollama · thinking disabled</p>
<p>The expanded comparison improved from <b>329/380 to 373/380</b> fully correct passage results: <b>44 improved, zero regressions</b>. These are exact local-correction results on this finite corpus, not a general English proficiency or explanation-quality score.</p>
<div class="scroll"><table><thead><tr><th>Installed model</th><th>0.3.36</th><th>0.3.37</th><th>Improved</th><th>Regressed</th><th>New holdout</th><th>Old basics</th><th>Marked text</th></tr></thead><tbody>'''+table+'''</tbody></table></div>
<h2>What changed</h2><p>Related changes in one grammar structure now remain one correction. Previously, a correct model rewrite such as “I wonder where she is” could be split into two broken cards. Auxiliary changes and dependent verb forms, embedded questions and short reorderings are grouped; unrelated errors remain separate.</p>
<p>Up to 30 proposed corrections are reviewed in batches of six under the original total timeout, replacing the ten-finding rejection. The twelve-error passage now passes on every model. A failed later batch rejects the analysis rather than exposing unchecked partial feedback. Explicit code/literal labels are protected. Ordinary vocabulary highlights in backticks remain correctable and retain their Markdown markers.</p>
<h2>Cases and method</h2><p>The main set has 96 passages: 40 grammar, 10 structural, 30 correct-text controls, 12 multi-error paragraphs, two long contexts (about 1,800 and 4,200 characters), a repeated-target case and a twelve-error capacity case. One ambiguous “recommend me a book” construction is diagnostic only, leaving 95 scored passages per model.</p>
<p>The independent follow-up has 16 new contrastive passages plus the 24 previous basic regressions per model. Three additional marked-text passages test inflection, capitalization and American spelling inside backticks. In total, the final scored sets contain <b>552 model–passage results</b>, of which <b>540 pass</b>. The original basics pass <b>96/96</b>. A further <b>64 correction/gap exercises</b> were generated and validated against their approved corrections.</p>
<p>Baseline inference was live for all 384 main analyses. Later verification reuses responses only when the entire serialized request is identical, including model tag, system prompt, source input, schema and generation parameters. Changed requests go to Ollama. The first 160 holdout analyses were live; final verification reuses identical requests. Final main and holdout postprocessing was additionally replayed with <b>998 exact request-payload matches</b>. Cache/live counts are in the summary and each trace preserves provenance. Reuse is not an independent repeated inference test; no cached timings are used to claim faster generation.</p>
<p>Gold corrections are scorer-only and never enter model prompts. A corpus-construction typo and accepted alternative tense/inversion readings are documented in <a href="gold-errata.json">gold errata</a> and applied equally to baseline and candidate. A passing case requires every expected local correction, no extra edit and no failure. Different target anchors can pass if their one-edit source sentence is identical.</p>
<h2>Remaining errors</h2><p>Gemma sometimes overcorrects plural agreement after <code>none</code>. Qwen sometimes changes a factual past conditional from <code>was</code> to <code>were</code>, or changes a correct statement about a British spelling. Gemma 3 misses one collocation in a multi-error paragraph. These failures are retained in the results, rather than excluded or repaired by hard-coded expected answers.</p>'''+failures+'''
<h2>Limits and feedback quality</h2><p>Exact-edit correctness does not certify the explanation. In the holdout, Gemma 3 correctly changes “None of the equipment are working” to “is working”, but its explanation calls <i>equipment</i> plural and overgeneralizes the rule for <i>none</i>. Explanations were spot-checked, not exhaustively graded. Cards still need user review. These tests establish regression behavior for the selected passages; they do not prove stability or correctness for every book, learner text or model sampling run.</p>
<h2>Reproducibility</h2><p><a href="summary.json">Machine-readable summary</a> · <a href="cases.json">Expanded gold</a> · <a href="holdout.json">Follow-up gold</a> · <a href="final-results.json">Final main results</a> · <a href="baseline-results.json">Rescored baseline</a> · <a href="holdout-results.json">Follow-up results</a> · <a href="format-results.json">Marked-text results</a> · <a href="model-metadata.json">Weights and hardware</a></p>
<p>Compact trace JSONL files retain request inputs, all responses, parameters and cache provenance. System prompts and JSON schemas are pooled by SHA256 in request-systems.json and request-formats.json. Raw results and original gold snapshots are archived separately. baseline-client.mjs and final-client.mjs preserve the compiled test clients; archive.py rebuilds this report from local audit artifacts. Synthetic audits never contact Anki or alter vault files.</p></html>'''
(OUT / 'report.html').write_text(report,encoding='utf-8')
print(json.dumps(dict(models=models, main_before=summary['main_before'], main_after=summary['main_after'], final=summary['all_final_scored'], calls=summary['protocol']),ensure_ascii=False))
