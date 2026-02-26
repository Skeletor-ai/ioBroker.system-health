'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('i18n completeness', () => {
    const i18nDir = path.join(__dirname, '..', 'admin', 'i18n');

    let enKeys, deKeys;

    test('i18n files exist', () => {
        assert.ok(fs.existsSync(path.join(i18nDir, 'en.json')), 'en.json missing');
        assert.ok(fs.existsSync(path.join(i18nDir, 'de.json')), 'de.json missing');
    });

    test('i18n files are valid JSON', () => {
        const en = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en.json'), 'utf8'));
        const de = JSON.parse(fs.readFileSync(path.join(i18nDir, 'de.json'), 'utf8'));
        enKeys = Object.keys(en);
        deKeys = Object.keys(de);
        assert.ok(enKeys.length > 0, 'en.json is empty');
        assert.ok(deKeys.length > 0, 'de.json is empty');
    });

    test('all en.json keys exist in de.json', () => {
        const en = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en.json'), 'utf8'));
        const de = JSON.parse(fs.readFileSync(path.join(i18nDir, 'de.json'), 'utf8'));
        const missing = Object.keys(en).filter(k => !(k in de));
        assert.strictEqual(missing.length, 0,
            `Keys in en.json missing from de.json:\n  ${missing.join('\n  ')}`);
    });

    test('all de.json keys exist in en.json', () => {
        const en = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en.json'), 'utf8'));
        const de = JSON.parse(fs.readFileSync(path.join(i18nDir, 'de.json'), 'utf8'));
        const missing = Object.keys(de).filter(k => !(k in en));
        assert.strictEqual(missing.length, 0,
            `Keys in de.json missing from en.json:\n  ${missing.join('\n  ')}`);
    });

    test('no empty translation values', () => {
        const en = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en.json'), 'utf8'));
        const de = JSON.parse(fs.readFileSync(path.join(i18nDir, 'de.json'), 'utf8'));
        const emptyEn = Object.entries(en).filter(([, v]) => !v || v.trim() === '').map(([k]) => k);
        const emptyDe = Object.entries(de).filter(([, v]) => !v || v.trim() === '').map(([k]) => k);
        const allEmpty = [...emptyEn.map(k => `en:${k}`), ...emptyDe.map(k => `de:${k}`)];
        assert.strictEqual(allEmpty.length, 0,
            `Empty translation values:\n  ${allEmpty.join('\n  ')}`);
    });
});
