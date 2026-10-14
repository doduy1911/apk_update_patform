export async function up(pgm) {
  pgm.createTable('admin_users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    username: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('admin_sessions', {
    sid: { type: 'varchar(255)', primaryKey: true },
    sess: { type: 'jsonb', notNull: true },
    expire: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('admin_sessions', 'expire');

  pgm.createTable('apps', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    package_name: { type: 'text', notNull: true, unique: true },
    signing_cert_sha256: { type: 'char(64)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('releases', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    app_id: { type: 'uuid', notNull: true, references: 'apps(id)', onDelete: 'RESTRICT' },
    version_code: { type: 'bigint', notNull: true },
    version_name: { type: 'text', notNull: true },
    release_notes: { type: 'text' },
    min_sdk: { type: 'integer', notNull: true },
    supported_abis: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    file_key: { type: 'text', notNull: true, unique: true },
    sha256: { type: 'char(64)', notNull: true },
    signing_cert_sha256: { type: 'char(64)', notNull: true },
    file_size_bytes: { type: 'bigint', notNull: true },
    status: { type: 'text', notNull: true, default: 'published' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('releases', 'releases_version_code_positive', { check: 'version_code > 0' });
  pgm.addConstraint('releases', 'releases_min_sdk_positive', { check: 'min_sdk > 0' });
  pgm.addConstraint('releases', 'releases_file_size_positive', { check: 'file_size_bytes > 0' });
  pgm.addConstraint('releases', 'releases_status_valid', { check: "status IN ('published', 'withdrawn')" });
  pgm.addConstraint('releases', 'releases_app_version_unique', { unique: ['app_id', 'version_code'] });
  pgm.addConstraint('releases', 'releases_sha256_format', { check: "sha256 ~ '^[0-9a-fA-F]{64}$'" });
  pgm.addConstraint('releases', 'releases_signing_sha256_format', { check: "signing_cert_sha256 ~ '^[0-9a-fA-F]{64}$'" });
  pgm.createIndex('releases', [{ name: 'app_id' }, { name: 'version_code', sort: 'DESC' }], {
    name: 'releases_app_version_idx',
  });
  pgm.createIndex('releases', ['app_id', 'status', 'version_code'], {
    name: 'releases_published_latest_idx',
    where: "status = 'published'",
  });

  pgm.createTable('admin_api_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    admin_user_id: { type: 'uuid', notNull: true, references: 'admin_users(id)', onDelete: 'CASCADE' },
    token_hash: { type: 'char(64)', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_used_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('admin_api_tokens', ['admin_user_id', 'revoked_at']);
}

export async function down(pgm) {
  pgm.dropTable('admin_api_tokens');
  pgm.dropTable('releases');
  pgm.dropTable('apps');
  pgm.dropTable('admin_sessions');
  pgm.dropTable('admin_users');
}
