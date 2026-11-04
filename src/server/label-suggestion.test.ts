import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CATEGORIES, COMPLEXITIES, COMPLEXITY_DESCRIPTIONS, LABEL_NAMES, PRIORITIES, PRIORITY_NAMES, SUBCATEGORIES } from '../core/labels';
import { LABELS_SKILL_FILE, labelsFrom, labelsGuide, labelWords } from './label-suggestion';

describe('the labels skill', () => {
  test('names every value of the lists and the complexity scale as src/core/labels.ts has them', () => {
    const skill = readFileSync(LABELS_SKILL_FILE, 'utf8');
    expect(skill).toMatch(/^---\nname: labels\ndescription: .+\n---\n/);
    for (const k of [...CATEGORIES, ...SUBCATEGORIES]) expect(skill).toContain(`- ${LABEL_NAMES[k]}: `);
    for (const p of PRIORITIES) expect(skill).toContain(`- ${PRIORITY_NAMES[p]}: `);
    for (const c of COMPLEXITIES) expect(skill).toContain(`- ${c}: ${COMPLEXITY_DESCRIPTIONS[c]}`);
    expect(labelsGuide()).toStartWith('# Judging a card');
  });

  test('a tool call’s names map to the lists; what was not asked or is off the lists is left out', () => {
    expect(labelsFrom({ category: 'data migration', subcategory: 'Refactor', complexity: 4, priority: 'Critical' }, ['category', 'complexity', 'priority'])).toEqual({
      category: 'dataMigration',
      priority: 'critical',
    });
    expect(labelWords(['category', 'subcategory', 'complexity'])).toBe('category, sub-category and complexity');
  });
});
