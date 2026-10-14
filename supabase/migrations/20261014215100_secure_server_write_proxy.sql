CREATE TABLE IF NOT EXISTS public.integration_secrets (
  name text PRIMARY KEY,
  secret_sha256 text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integration_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.integration_secrets TO service_role;

-- Provision the per-environment secret hash through private deployment setup.
-- Never commit the raw write-proxy secret or its hash to the repository.
