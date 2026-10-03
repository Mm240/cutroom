import { Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export type Stage =
  | 'queued' | 'uploading' | 'transcribing' | 'planning'
  | 'rendering' | 'ready' | 'failed';

export interface Job {
  id: string;
  name: string;
  stage: Stage;
  progress: number;
  payload: Record<string, unknown>;
  error?: string;
}

@Injectable()
export class JobsStore implements OnModuleInit {
  private pool = new Pool({ connectionString: process.env.DATABASE_URL });

  async onModuleInit() {
    await this.pool.query(`
      create table if not exists jobs (
        id uuid primary key,
        name text not null,
        stage text not null,
        progress int not null default 0,
        payload jsonb not null default '{}'::jsonb,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
  }

  async create(name: string): Promise<Job> {
    const { rows } = await this.pool.query(
      `insert into jobs (id, name, stage) values ($1, $2, 'queued') returning *`,
      [randomUUID(), name],
    );
    return this.map(rows[0]);
  }

  async patch(
    id: string,
    patch: { stage?: Stage; progress?: number; error?: string },
    merge?: Record<string, unknown>,
  ): Promise<Job> {
    const { rows } = await this.pool.query(
      `update jobs set
         stage = coalesce($2, stage),
         progress = coalesce($3, progress),
         error = coalesce($4, error),
         payload = payload || $5::jsonb,
         updated_at = now()
       where id = $1 returning *`,
      [id, patch.stage ?? null, patch.progress ?? null, patch.error ?? null,
       JSON.stringify(merge ?? {})],
    );
    return this.map(rows[0]);
  }

  async get(id: string): Promise<Job | null> {
    const { rows } = await this.pool.query(`select * from jobs where id = $1`, [id]);
    return rows[0] ? this.map(rows[0]) : null;
  }

  async recent(limit = 12): Promise<Job[]> {
    const { rows } = await this.pool.query(
      `select * from jobs order by created_at desc limit $1`, [limit],
    );
    return rows.map((r) => this.map(r));
  }

  private map(r: any): Job {
    return {
      id: r.id, name: r.name, stage: r.stage, progress: r.progress,
      payload: r.payload, error: r.error ?? undefined,
    };
  }
}
