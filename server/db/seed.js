export function seedConfig(db, config, { now = new Date() } = {}) {
  const ts = now.toISOString();

  const upsertServer = db.prepare(`
    INSERT INTO servers (id, name, ip, display_order, enabled, created_at, updated_at)
    VALUES (@id, @name, @ip, @order, @enabled, @ts, @ts)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      ip = excluded.ip,
      display_order = excluded.display_order,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);

  const upsertService = db.prepare(`
    INSERT INTO services (id, name, url, display_order, enabled, created_at, updated_at)
    VALUES (@id, @name, @url, @order, @enabled, @ts, @ts)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      url = excluded.url,
      display_order = excluded.display_order,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);

  const upsertProject = db.prepare(`
    INSERT INTO projects (
      id, name, description, github_owner, github_repo, website_url,
      api_type, api_base, display_order, visible, featured, updated_at
    )
    VALUES (
      @id, @name, @description, @githubOwner, @githubRepo, @website,
      @apiType, @apiBase, @order, @visible, @featured, @ts
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      github_owner = excluded.github_owner,
      github_repo = excluded.github_repo,
      website_url = excluded.website_url,
      api_type = excluded.api_type,
      api_base = excluded.api_base,
      display_order = excluded.display_order,
      visible = excluded.visible,
      featured = excluded.featured,
      updated_at = excluded.updated_at
  `);

  db.transaction(() => {
    for (const server of config.servers) {
      upsertServer.run({
        id: server.id,
        name: server.name,
        ip: server.ip,
        order: server.order,
        enabled: server.enabled ? 1 : 0,
        ts
      });
    }

    for (const service of config.services) {
      upsertService.run({
        id: service.id,
        name: service.name,
        url: service.url,
        order: service.order,
        enabled: service.enabled ? 1 : 0,
        ts
      });
    }

    for (const project of config.projects) {
      upsertProject.run({
        id: project.id,
        name: project.name,
        description: project.description,
        githubOwner: project.github?.owner || null,
        githubRepo: project.github?.repo || null,
        website: project.website || null,
        apiType: project.api?.type || null,
        apiBase: project.api?.base || null,
        order: project.order,
        visible: project.visible ? 1 : 0,
        featured: project.featured ? 1 : 0,
        ts
      });
    }
  })();
}
