GRANT SELECT ON TABLE public.game_rounds TO anon, authenticated;

DROP POLICY IF EXISTS verified_msport_aviator_read ON public.game_rounds;
CREATE POLICY verified_msport_aviator_read
  ON public.game_rounds
  FOR SELECT
  TO anon, authenticated
  USING (provider = 'msport' AND game_code = 'aviator' AND source_verified = true);
