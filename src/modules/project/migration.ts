import { type Project, ProjectSchema } from './model';
import { ProjectSchema as LegacyProjectSchema } from './project.schema';

export function migrateProjectV1(value: unknown, hasPlan = false): Project {
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 2)
    return ProjectSchema.parse(value);
  const { pdfAssetId: _asset, ...old } = LegacyProjectSchema.parse(value);
  return ProjectSchema.parse({
    ...old,
    schemaVersion: 2,
    lastOpenedStep: old.currentDeckId ? 'slides' : hasPlan ? 'outline-speech' : 'paper-analysis',
  });
}
