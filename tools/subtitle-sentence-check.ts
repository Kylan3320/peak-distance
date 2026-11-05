import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  alignFragmentTranslatedCues, alignLearningTranslations, alignTranslatedCues, buildCueTranslationBatch,
  buildSubtitleViews, buildTranslateWindow, cueIndexAt, fmtClock, normalizeAsrCues, parseJson3,
} from '../shared/cues';
import type { SourceFragment } from '../shared/protocol';

export function subtitleSentenceChecks(check: (name: string, pass: boolean) => void): void {
  const make = (texts: string[], starts = texts.map((_, i) => i * 1000)): SourceFragment[] =>
    texts.map((text, i) => ({ start: starts[i]!, dur: 1000, text, lastOff: starts[i]! }));
  const sentences = [
    'But I I sometimes think our society gets too binary.',
    "Everything's either black or white.",
    'Everything gets polarized because of that.',
  ];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const texts = (fragments: SourceFragment[], lang = 'en') =>
    buildSubtitleViews(fragments, 'manual', lang).cues.map(c => c.text);
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
  check('跨句译文不复用，整项完整成员的对应译文可以拼接',
    same(translated.map(c => c.zh), [undefined, undefined, '三句开头 在这里。', '四。']));
  check('仅有时间重叠、缺少或重复源事件译文时整项回退',
    !alignLearningTranslations(views, [{ ...exact[3]!, start: 4310 }])[3]?.zh &&
    !alignLearningTranslations(views, [exact[1]!])[2]?.zh &&
    !alignLearningTranslations(views, [...exact, exact[2]!])[2]?.zh);
  const fragmentZh = alignFragmentTranslatedCues(views.fragments, exact);
  check('播放器保留短片段译文，不复用跨片段歧义译文',
    fragmentZh[0]?.zh === '一。二！' &&
    alignFragmentTranslatedCues(views.fragments, [{ ...exact[1]!, dur: 1800 }]).every(c => !c.zh));
  const batch = buildCueTranslationBatch(views.cues, views.fragments, [0, 1, 2, 3], [0, 1, 2, 3]);
  check('回退各句按全文请求，同全文共用请求，播放器域保持独立',
    same(batch.items.slice(0, 2).map(i => i.text), ['One.', 'Two!']) &&
    batch.targets.find(t => t.view === 'fragments' && t.index === 0)?.id === views.cues.length &&
    batch.targets.find(t => t.view === 'fragments' && t.index === 3)?.id === 3);
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
  check('翻译窗口：前后各 1/4', JSON.stringify(buildTranslateWindow(10, 5, 1, 4)) === '[4,5,6,7,8,9]');
  check('翻译窗口：边界收敛', JSON.stringify(buildTranslateWindow(10, 0, 1, 4)) === '[0,1,2,3,4]');
  check('翻译窗口：无当前句为空', buildTranslateWindow(10, -1, 1, 4).length === 0);
  check('时钟格式', fmtClock(65000) === '1:05' && fmtClock(3723000) === '1:02:03');
  const english = [{ start: 0, dur: 2000, text: 'first', lastOff: 0 }, { start: 2000, dur: 2000, text: 'second', lastOff: 2000 }];
  const chinese = [{ start: 2200, dur: 1700, text: '第二句', lastOff: 2200 }];
  const aligned = alignTranslatedCues(english, chinese);
  check('独立轨道缺首句不导致后句错配', !aligned[0]?.zh && aligned[1]?.zh === '第二句');
  const paired = normalizeAsrCues([{ start: 0, dur: 1200, text: 'the', zh: '这', lastOff: 700 }, { start: 800, dur: 1600, text: 'the plane', zh: '这架飞机', lastOff: 1800 }]);
  check('ASR 英文合并同时转换平台配对译文', paired.length === 1 && paired[0]?.zh === '这架飞机');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  subtitleSentenceChecks((name, pass) => { assert.ok(pass, name); console.log('PASS', name); });
}
