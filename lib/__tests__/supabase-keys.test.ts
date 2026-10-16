import {afterEach,describe,expect,it,vi} from 'vitest'
import {publishableKey,supabaseFetch} from '@/lib/supabase/keys'
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
describe('Supabase API keys',()=>{
 it('prefers the publishable key and never serves a secret as public configuration',()=>{
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','sb_publishable_fixture')
  expect(publishableKey()).toBe('sb_publishable_fixture')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','sb_secret_fixture')
  expect(()=>publishableKey()).toThrow('Public Supabase configuration is unavailable')
 })
 it('puts consumer keys only on apikey while retaining authenticated user JWTs',async()=>{
  const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json([]))
  await supabaseFetch('https://fixture.supabase.co/rest/v1/listings',{headers:{apikey:'sb_secret_fixture',Authorization:'Bearer sb_secret_fixture'}})
  const a=new Headers(fetchMock.mock.calls[0][1]?.headers)
  expect(a.get('apikey')).toBe('sb_secret_fixture');expect(a.get('authorization')).toBeNull()
  await supabaseFetch('https://fixture.supabase.co/rest/v1/listings',{headers:{apikey:'sb_publishable_fixture',Authorization:'Bearer fixture-user-jwt'}})
  expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('authorization')).toBe('Bearer fixture-user-jwt')
 })
})
