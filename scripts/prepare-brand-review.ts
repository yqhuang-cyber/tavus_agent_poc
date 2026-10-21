import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareBrandReview } from '../eval/brand-samples.js';
import { offlineReportDirectory, writeOfflineReport } from '../packages/verification/reports.js';

const report = prepareBrandReview();
await writeOfflineReport('brand-review.json', report);
const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
const rows = report.samples.map(s => `| ${s.id} | ${s.category} / ${s.kind} | ${cell(s.text)} | ${cell(s.observe.join('；'))} | 未运行 |`);
const markdown = ['# 中文/品牌 20 段审核准备', '', '本地 PRD 草案，仅准备脚本；未生成媒体或开展真人审核。固定朗读与对话刺激分开执行，不将刺激文本冒充教师输出。', '',
  '正式审核前填写 JSON 的 Face/Voice/Pi/TTS 配置及每条的参考真人素材、实际输出、录制引用、审核者、设备和地区。身份一致性、中文听感和品牌分别审核；原评分锚点待导入，不产生自动通过或替代分数。', '',
  '| ID | 类型 | 固定朗读文本或学生刺激 | 人工观察点 | 结果 |', '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
await writeFile(resolve(offlineReportDirectory(), 'brand-review.md'), markdown, { mode: 0o600 });
console.log(JSON.stringify({ sample_count: report.sample_count, real_outputs: report.real_outputs, brand_approval: report.brand_approval }));
