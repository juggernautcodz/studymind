import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(
  new URL(
    "../prisma/migrations/20260924030000_add_exam_readiness/migration.sql",
    import.meta.url,
  ),
);
const migrationSql = readFileSync(migrationPath, "utf8");

function legacyTopicIdsPolicy(value: string | null): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  } catch {
    return [];
  }
}

test("legacy topicIds policy preserves valid arrays", () => {
  assert.deepEqual(legacyTopicIdsPolicy('["topic-a","topic-b"]'), [
    "topic-a",
    "topic-b",
  ]);
  assert.deepEqual(legacyTopicIdsPolicy("[]"), []);
});

test("legacy topicIds policy skips null, empty, and malformed values", () => {
  assert.deepEqual(legacyTopicIdsPolicy(null), []);
  assert.deepEqual(legacyTopicIdsPolicy(""), []);
  assert.deepEqual(legacyTopicIdsPolicy("   "), []);
  assert.deepEqual(legacyTopicIdsPolicy('["topic-a"'), []);
});

test("legacy topicIds policy skips every valid non-array JSON type", () => {
  for (const value of [
    '{"topic":"topic-a"}',
    '"topic-a"',
    "42",
    "true",
    "false",
    "null",
  ]) {
    assert.deepEqual(legacyTopicIdsPolicy(value), []);
  }
});

test("legacy topicIds policy keeps only usable string array elements", () => {
  assert.deepEqual(
    legacyTopicIdsPolicy(
      '[null,42,true,{"id":"topic-a"},["topic-b"],"", "   ","topic-a","topic-b"]',
    ),
    ["topic-a", "topic-b"],
  );
});

test("migration uses guarded parsing for every legacy backfill", () => {
  assert.match(
    migrationSql,
    /EXCEPTION\s+WHEN\s+OTHERS\s+THEN\s+RETURN '\[\]'::jsonb;/s,
  );
  assert.match(migrationSql, /jsonb_typeof\("parsed"\)\s+<>\s+'array'/);
  assert.doesNotMatch(migrationSql, /"topicIds"\s*::\s*jsonb/);
  assert.doesNotMatch(migrationSql, /jsonb_array_elements_text/);

  const guardedExpansions = migrationSql.match(
    /jsonb_array_elements\("_studymind_20260924030000_safe_jsonb_array"\("Exam"\."topicIds"\)\)/g,
  );
  assert.equal(guardedExpansions?.length, 3);

  const stringGuards = migrationSql.match(
    /jsonb_typeof\("Element"\."value"\) = 'string'/g,
  );
  assert.equal(stringGuards?.length, 3);

  const emptyElementGuards = migrationSql.match(
    /NULLIF\(btrim\("Element"\."value" #>> '\{\}'\), ''\) IS NOT NULL/g,
  );
  assert.equal(emptyElementGuards?.length, 3);
});

test("migration preserves owned valid-topic backfill and drops its helper", () => {
  assert.match(migrationSql, /"Topic"\."userId"\s*=\s*"Exam"\."userId"/);
  assert.match(migrationSql, /"Course"\."userId"\s*=\s*"Exam"\."userId"/);
  assert.match(migrationSql, /HAVING COUNT\(DISTINCT "courseId"\) = 1/);
  assert.match(
    migrationSql,
    /DROP FUNCTION "_studymind_20260924030000_safe_jsonb_array"\(TEXT\);/,
  );
});
