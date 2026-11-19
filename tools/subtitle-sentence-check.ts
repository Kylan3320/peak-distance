import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  alignLearningTranslations, buildCueTranslationBatch,
  buildSegmentedSubtitleViews, buildSubtitleViews, cueIndexAt, fmtClock, normalizeAsrCues, parseJson3,
} from '../shared/cues';
import type { SourceFragment } from '../shared/protocol';
import { matchSentenceBookmarks, sentenceId, type SavedSentence, type VideoRef } from '../shared/vocab';
import { parseSentenceDocument, serializeSentenceRecord } from '../lib/vault/format';
import { sentenceToVaultRecord } from '../lib/vault/records';

export async function subtitleSentenceChecks(check: (name: string, pass: boolean) => void): Promise<void> {
  const make = (texts: string[], starts = texts.map((_, i) => i * 1000)): SourceFragment[] =>
    texts.map((text, i) => ({ start: starts[i]!, dur: 1000, text, lastOff: starts[i]! }));
  const sentences = [
    'But I I sometimes think our society gets too binary.',
    "Everything's either black or white.",
    'Everything gets polarized because of that.',
  ];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const restored = await buildSegmentedSubtitleViews(make([
    'did you lock the', 'door we missed', 'the train should', 'we walk', '[Applause]', 'yes',
  ]), 'asr', 'en', async inputs => {
    check('模型按连续原文推断，声音提示独立，单词回答直接保留',
      same(inputs, ['did you lock the door we missed the train should we walk']));
    return ['Did you lock the door? We missed the train. Should we walk?'];
  });
  check('预测切点保留原大小写与文字，不将不同首片段归入同一回放区间',
    same(restored.cues.map(c => [c.text, c.start]), [
      ['did you lock the door', 0], ['we missed the train', 1000], ['should we walk', 2000],
      ['[Applause]',4000], ['yes',5000],
    ]));
  for (const response of [[], ['Unrelated prediction.']]) {
    const degraded = await buildSegmentedSubtitleViews(make(['Already good.', 'this is','part of the idea']), 'asr', 'en',
      async () => response);
    check('失败或改写原词的预测标明暂用源片段，仍可使用可靠的原句',
      degraded.segmentationFallback === true &&
      same(degraded.cues.map(c => [c.text, Boolean(c.segmentationFallback)]),
        [['Already good.', false], ['this is', true], ['part of the idea', true]]));
  }
  const mixed = await buildSegmentedSubtitleViews(make([
    'the U.S. team saw Dr. smith', 'at 3.14 today. this is', 'another thought',
  ]), 'asr', 'en', async () => []);
  check('小写起句可在源片中间恢复真实句界，保留缩写称谓与小数',
    same(mixed.cues.map(c => [c.text, Boolean(c.segmentationFallback)]), [
      ['the U.S. team saw Dr. smith at 3.14 today.',false], ['this is',true], ['another thought',true],
    ]));
  const texts = (fragments: SourceFragment[], lang = 'en') =>
    buildSubtitleViews(fragments, 'manual', lang).cues.map(c => c.text);
  const complete = ('The accuracy of the estimated probability for the true next word, ' +
    'which the network calculates from the preceding context, can improve as the network learns, ' +
    'and the calculation can become more efficient if the work is divided across several processors.');
  const reliableLong = await buildSegmentedSubtitleViews(make([complete]), 'manual', 'en',
    async () => { throw Error('A complete sentence should bypass inference'); });
  check('带可靠句界的长句保留整句译文上下文', same(reliableLong.cues.map(c => c.text), [complete]));
  // Actual independent assertions in the skiing ASR, with the local model's
  // comma-only prediction. Times and raw source spelling must both survive.
  const ideas = [
    "we tend to teach what we're comfortable with",
    "and I'm a little bit uncomfortable talking about this because I don't know it through and through to a te",
    "what I do know as I often say is my experience as a at a cellular level as an accomplished skier what I'm feeling",
    "and and that's what I convey",
  ];
  const ideaCues = await buildSegmentedSubtitleViews(make(ideas), 'asr', 'en', async () => [
    ideas.join(', ').replace('know as I often say is','know, as I often say, is') + '.',
  ]);
  check('长口语仅在有独立主谓的分句处分开，保留原因与插入语以及每段真实起点',
    same(ideaCues.cues.map(c => [c.text,c.start]), ideas.map((text,i) => [text,i*1000])));
  const linked = "i didn't realize how much it mattered until I tried the same exercise for myself and watched what happened to my balance and the pressure under both feet";
  const connected = await buildSegmentedSubtitleViews(make([linked]), 'asr', 'en',
    async () => [linked.replace(' until',', until').replace(' and watched',', and watched') + '.']);
  check('否定时序及共用主语的动词不因长度和模型逗号拆分', same(connected.cues.map(c=>c.text),[linked]));
  const continuation = "I think running up the hill a little faster improves my balance";
  const repaired = await buildSegmentedSubtitleViews(make(["I know it", continuation]), 'asr', 'en',
    async () => ["I? know it. I think running up the hill. A little faster improves my balance."]);
  check('预测标点不能把孤立主语或动名词主语与其谓语拆开',same(repaired.cues.map(c => c.text),["I know it",continuation]));
  for (const first of ['running every morning improves my balance','I think running every morning improves my balance']) {
    const second = 'faster runs can help me build strength';
    const separate = await buildSegmentedSubtitleViews(make([first,second]),'asr','en',async () => [first + '. ' + second + '.']);
    check('已有谓语的动名词句与下一句比较级主语保持独立',same(separate.cues.map(c=>c.text),[first,second]));
  }
  const examples = [
    ["This particular morning before sunrise, and I have rarely seen such strong winds coming down from the mountains, was the worst time to attempt this exercise with the children"],
    ["I am still waiting to find out, what we learned is supposed to tell us about the changes in the pressure under both feet during this exercise"],
    ["I am saying nothing except, what we learned is that this exercise can make a difference to the balance of the students in our class"],
    ["We do not teach this exercise because, what we have learned is that it can cause pain in the ankles when the balance is wrong"],
    ["we collected the final samples before the storm reached the camp at the foot of the mountain", "but they were still waiting for permission to ship the crates back to the laboratory"],
    ["I, along with the rest of the research team, and I believe several of the volunteers as well, will be staying in this building until tomorrow morning"],
    ["what I would really like to know is, what he actually thinks is wrong with the plan to move all the equipment back to the laboratory tomorrow"],
  ];
  for (const clauses of examples) {
    const source = clauses.join(', ') + '.';
    const reading = buildSubtitleViews(make([source]), 'asr', 'en').cues.map(c=>c.text);
    check('协调新断言可独立翻译，主语插入语和未完表语保留在主句内',
      same(reading, clauses.length === 1 ? [source] : [clauses[0] + ',', clauses[1] + '.']));
  }
  const unmarkedIdeas = [
    'we arrived at the station in time to see the last train leave',
    'the ticket office had closed and the next bus was still an hour away',
    'we decided to walk home together and found a much shorter route along the river.',
  ];
  const sparse = await buildSegmentedSubtitleViews(make(unmarkedIdeas), 'asr', 'en',
    async () => [unmarkedIdeas.map((line,i)=>line + (i<2 ? '.' : '')).join(' ')]);
  check('自动字幕末尾偶有句号时仍可找回长段内的句界',same(sparse.cues.map(c=>c.text),unmarkedIdeas));
  const packets = [
    [sentences.join(' ')],
    sentences,
    ['But I I sometimes think', 'our society gets too binary. Everything\'s either', 'black or white. Everything gets polarized', 'because of that.'],
  ];
  for (const packet of packets) {
    const { cues } = buildSubtitleViews(make(packet), 'manual', 'en');
    const original = packet.join(' ');
    const rebuilt = cues.map((cue, i) => original.slice(cues[i - 1]?.to ?? 0, cue.from) + cue.text).join('');
    check('不同分包保留三句、口头重复和完整原文', same(cues.map(c => c.text), sentences) && rebuilt === original);
  }
  check('间隔超过 1500ms 仍可跨片段成句',
    same(texts(make(['When the rain', 'stopped, we left.'], [0, 3100])), ['When the rain stopped, we left.']));
  check('称谓、小数及首字母缩写不误切',
    same(texts(make(['I saw Dr.', 'Smith today.', 'It costs 3.', '14 dollars.', 'The U.', 'S. team won.'])),
      ['I saw Dr. Smith today.', 'It costs 3. 14 dollars.', 'The U. S. team won.']));
  check('中文和日文按原有规则连接并逐句拆分',
    same(texts(make(['你好', '世界。再见！']), 'zh-Hans'), ['你好世界。', '再见！']) &&
    same(texts(make(['これは', '日本語。次です。']), 'ja'), ['これは日本語。', '次です。']));
  check('阿拉伯语问号和印地语句号均确认句末，保留闭引号与原文',
    same(texts(make(['كيف حالك؟ أنا بخير.']), 'ar'), ['كيف حالك؟', 'أنا بخير.']) &&
    same(texts(make(['यह पहला वाक्य है। यह दूसरा वाक्य है।']), 'hi'), ['यह पहला वाक्य है।', 'यह दूसरा वाक्य है।']) &&
    same(texts(make(['«كيف حالك؟» أنا بخير.']), 'ar'), ['«كيف حالك؟»', 'أنا بخير.']));
  check('回退只使用未完成区间和源片段的交集',
    same(texts(make(['First sentence. Unfinished', 'tail'])), ['First sentence.', 'Unfinished', 'tail']) &&
    same(texts(make(['one', 'two', 'three'])), ['one', 'two', 'three']));
  const speakers = parseJson3({ events: [
    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'First line\nwithout punctuation' }] },
    { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '>> New speaker >>Again.' }] },
  ] });
  check('换行无句界，片段开头和内部的换人边界均保留',
    same(texts(speakers), ['First line without punctuation', 'New speaker', 'Again.']) &&
    speakers[1]?.text === 'New speaker Again.');

  const raw = make(['First', 'First line.', 'First line.', 'Next line.'], [0, 200, 1400, 2500]);
  const asr = buildSubtitleViews(raw, 'asr', 'en');
  check('时间重叠的前缀滚动合并，分开的同文实读保留',
    same(asr.fragments.map(c => [c.text, c.start, c.dur]),
      [['First line.', 0, 1200], ['First line.', 1400, 1000], ['Next line.', 2500, 1000]]));
  check('相接的相同原文保留，同起点的滚动重复只延伸时长',
    normalizeAsrCues(make(['Go.', 'Go.'])).length === 2 &&
    normalizeAsrCues([make(['Go.'])[0]!, { ...make(['Go.'])[0]!, dur: 1500 }])[0]?.dur === 1500);
  const repeated = make(['I', 'I think so.'], [0, 500]).map(c => ({ ...c, anchors: [{ offset: 0, time: c.start }] }));
  check('词段时间区分重叠事件中的再次实读', normalizeAsrCues(repeated).length === 2);

  const timeFixture = (anchored: boolean) => buildSubtitleViews(parseJson3({ events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: '  One.\n' }, { utf8: ' Two!', ...(anchored ? { tOffsetMs: 800 } : {}) }] },
    { tStartMs: 2500, dDurationMs: 2000, segs: [{ utf8: 'Three starts' }] },
    { tStartMs: 3600, dDurationMs: 1000, segs: [{ utf8: 'here.' }] },
    { tStartMs: 4300, dDurationMs: 1000, segs: [{ utf8: 'Four ends.' }] },
  ] }), 'manual', 'en');
  for (const anchored of [true, false]) {
    const { cues, intervals, fragments } = timeFixture(anchored);
    check('片段内拆句保留各自原文位置，跨片段保留首尾来源',
      same(cues.slice(0, 3).map(c => [c.firstFragment, c.lastFragment, c.firstOffset, c.lastOffset]),
        [[0, 0, 0, 4], [0, 0, 5, 9], [1, 2, 0, 5]]) &&
      cues[2]?.text === 'Three starts here.');
    check(anchored ? '词段锚点使句界可定位' : '缺锚点的句子共用一个正时长区间',
      same(cues.slice(0, 2).map(c => [c.start, c.dur, c.interval]),
        anchored ? [[0, 800, 0], [800, 1200, 1]] : [[0, 2000, 0], [0, 2000, 0]]) &&
      cueIndexAt(fragments, 800) === 0 && intervals[cueIndexAt(intervals, 800)]?.firstCue === (anchored ? 1 : 0));
    check('句末使用末片段终点并裁剪到下一可定位项，末项保留其源终点',
      intervals.at(-2)?.lastFragment === 2 && cues[2]?.start === 2500 && cues[2].dur === 1800 &&
      cues[3]?.start === 4300 && cues[3].dur === 1000);
  }
  const views = timeFixture(false);
  const exact = make(['一。二！', '三句开头', '在这里。', '四。'], [0, 2500, 3600, 4300]);
  exact[0]!.dur = 2000;
  exact[1]!.dur = 2000;
  const translated = alignLearningTranslations(views, exact);
  check('仅完整一对一的平台字幕可复用，跨片段句子交给整句翻译',
    same(translated.map(c => c.zh), [undefined, undefined, undefined, '四。']));
  check('仅有时间重叠、缺少或重复源事件译文时整项回退',
    !alignLearningTranslations(views, [{ ...exact[3]!, start: 4310 }])[3]?.zh &&
    !alignLearningTranslations(views, [exact[1]!])[2]?.zh &&
    !alignLearningTranslations(views, [...exact, exact[2]!])[2]?.zh);
  const repeatedCues = [...views.cues, views.cues[2]!];
  const batch = buildCueTranslationBatch(repeatedCues, [2, 0, 1, 3, 4], 2);
  check('同一份学习句候选按当前句优先，同文复用整句结果',
    same(batch.items.map(i => i.text), [views.cues[2]!.text, 'One.']) &&
    same(batch.targets, [{index:2,id:2}, {index:0,id:0}, {index:4,id:2}]));
  const video: VideoRef = { videoId: 'test', trackId: 'https://www.youtube.com/api/timedtext?v=test&lang=en',
    trackKind: 'manual', trackLang: 'en', startMs: 0 };
  const duplicate = buildSubtitleViews(make(['No. No.']), 'manual', 'en').cues;
  const oldId = sentenceId(video, 'No.');
  const ids = duplicate.map(cue => sentenceId(video, cue.text, cue));
  const record = (id: string): SavedSentence => ({ id, video, text: 'No.', endMs: 1000, title: 'Fixture', createdAt: 1 });
  const legacy = record(oldId);
  check('同文同时间的新收藏用原文范围区分',
    same(ids.map(id => JSON.parse(id).at(-1)), [[0, 3], [4, 7]]) &&
    matchSentenceBookmarks(video, duplicate, [record(ids[0]!)]).map(row => !!row.saved).join() === 'true,false');
  check('旧收藏只关联唯一匹配项，保留实际 ID',
    matchSentenceBookmarks(video, duplicate, [legacy]).every(row => !row.saved) &&
    matchSentenceBookmarks(video, duplicate.slice(0, 1), [legacy])[0]?.saved?.id === oldId);
  check('学习库交换格式原样保留新旧收藏 ID',
    [oldId, ...ids].every(id => {
      const parsed = parseSentenceDocument(serializeSentenceRecord(sentenceToVaultRecord(record(id))));
      return !('error' in parsed) && parsed.id === id;
    }));
  const cues = [
    { start: 0, dur: 1000, text: 'a', lastOff: 1000 },
    { start: 2000, dur: 1500, text: 'b', lastOff: 3500 },
    { start: 4000, dur: 1000, text: 'c', lastOff: 5000 },
  ];
  check('句中命中', cueIndexAt(cues, 2500) === 1);
  check('句首边界命中', cueIndexAt(cues, 2000) === 1);
  check('句间空隙无句', cueIndexAt(cues, 3800) === -1);
  check('开头之前无句', cueIndexAt(cues, -5) === -1);
  check('末句内命中', cueIndexAt(cues, 4800) === 2);
  check('全片结束无句', cueIndexAt(cues, 9900) === -1);
  check('时钟格式', fmtClock(65000) === '1:05' && fmtClock(3723000) === '1:02:03');
  const paired = normalizeAsrCues([{ start: 0, dur: 1200, text: 'the', zh: '这', lastOff: 700 }, { start: 800, dur: 1600, text: 'the plane', zh: '这架飞机', lastOff: 1800 }]);
  check('ASR 英文合并同时转换平台配对译文', paired.length === 1 && paired[0]?.zh === '这架飞机');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await subtitleSentenceChecks((name, pass) => { assert.ok(pass, name); console.log('PASS', name); });
}
