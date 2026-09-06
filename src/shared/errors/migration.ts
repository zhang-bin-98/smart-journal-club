/** 未来版本数据：拒绝读取、迁移与写回，原样保留等待兼容应用。 */
export class UnsupportedSchemaVersionError extends Error {}
/** 旧版本数据无法确定性升级：稳定对象保留原数据并提示恢复方式；临时计划可由调用方回退重建。 */
export class LegacyMigrationError extends Error {}
