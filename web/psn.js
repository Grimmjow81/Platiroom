// Minimal PSN client: same endpoints, headers and query-string rules as the psn-api package,
// but with an injectable fetch so it can run in the Tauri webview (plugin-http) or in tests.

const AUTH_BASE_URL = 'https://ca.account.sony.com/api/authz/v3/oauth';
const TROPHY_BASE_URL = 'https://m.np.playstation.com/api/trophy';
const USER_LEGACY_BASE_URL = 'https://us-prof.np.community.playstation.net/userProfile/v1/users';

// Same logic as psn-api's buildRequestUrl: ":name" placeholders are replaced, everything else becomes a query parameter
export function buildRequestUrl(baseUrl, endpointUrl, options = {}, args = {}) {
  const { headerOverrides: _ignored, ...pickedOptions } = options;

  const concatenated = `${baseUrl}/${endpointUrl}`;
  const withoutDoubleSlashes = concatenated.replaceAll(/([^:]\/)\/+/g, '$1');

  let withArgs = withoutDoubleSlashes;
  const queryParamValues = {};

  for (const [argKey, argValue] of Object.entries({ ...args, ...pickedOptions })) {
    if (withArgs.includes(`:${argKey}`)) {
      withArgs = withArgs.replace(`:${argKey}`, String(argValue));
    } else if (argValue !== undefined) {
      queryParamValues[argKey] = String(argValue);
    }
  }

  const queryString = new URLSearchParams(queryParamValues).toString();
  return queryString.length > 0 ? `${withArgs}?${queryString}` : withArgs;
}

export function createPsn(fetchFn) {
  async function call(url, authorization, headers) {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authorization.accessToken}`,
        'Content-Type': 'application/json',
        ...headers
      }
    });
    return await response.json();
  }

  async function exchangeNpssoForCode(npssoToken) {
    const queryString = new URLSearchParams({
      access_type: 'offline',
      client_id: '09515159-7237-4370-9b40-3806e67c0891',
      redirect_uri: 'com.scee.psxandroid.scecompcall://redirect',
      response_type: 'code',
      scope: 'psn:mobile.v2.core psn:clientapp'
    }).toString();

    const { headers, status } = await fetchFn(`${AUTH_BASE_URL}/authorize?${queryString}`, {
      headers: { Cookie: `npsso=${npssoToken}` },
      redirect: 'manual',
      // Read by the Tauri http plugin: do not follow the redirect, we need the Location header
      maxRedirections: 0
    });

    const location = headers.get('location');
    if (!location || !location.includes('?code=')) {
      throw new Error(
        'There was a problem retrieving your PSN access code. Is your NPSSO code valid? ' +
        'To get a new NPSSO code, visit https://ca.account.sony.com/api/v1/ssocookie. ' +
        `(HTTP ${status}, location: ${location ? location.split('?')[0] : 'none'})`
      );
    }

    return new URLSearchParams(location.split('redirect/')[1]).get('code');
  }

  async function exchangeCodeForAccessToken(accessCode) {
    const res = await fetchFn(`${AUTH_BASE_URL}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A='
      },
      body: new URLSearchParams({
        code: accessCode,
        redirect_uri: 'com.scee.psxandroid.scecompcall://redirect',
        grant_type: 'authorization_code',
        token_format: 'jwt'
      }).toString()
    });

    const raw = await res.json();
    return {
      accessToken: raw.access_token,
      expiresIn: raw.expires_in,
      idToken: raw.id_token,
      refreshToken: raw.refresh_token,
      refreshTokenExpiresIn: raw.refresh_token_expires_in,
      scope: raw.scope,
      tokenType: raw.token_type
    };
  }

  async function getProfileFromUserName(authorization, userName) {
    const fields = [
      'npId,onlineId,accountId,avatarUrls,plus,aboutMe,languagesUsed',
      'trophySummary(@default,level,progress,earnedTrophies)',
      'isOfficiallyVerified,personalDetail(@default,profilePictureUrls),personalDetailSharing,personalDetailSharingRequestMessageFlag',
      'primaryOnlineStatus,presences(@default,@titleInfo,platform,lastOnlineDate,hasBroadcastData)',
      'requestMessageFlag,blocking,friendRelation,following,consoleAvailability'
    ].join(',');

    const url = buildRequestUrl(USER_LEGACY_BASE_URL, ':userName/profile2', {}, { userName, fields });
    const response = await call(url, authorization);
    if (response?.error) throw new Error(response.error.message ?? 'Unexpected Error');
    return response;
  }

  async function getUserTrophyProfileSummary(authorization, accountId, options) {
    const url = buildRequestUrl(TROPHY_BASE_URL, '/v1/users/:accountId/trophySummary', options, { accountId });
    return await call(url, authorization, options?.headerOverrides);
  }

  async function getUserTitles(authorization, accountId, options) {
    const url = buildRequestUrl(TROPHY_BASE_URL, '/v1/users/:accountId/trophyTitles', options, { accountId });
    return await call(url, authorization, options?.headerOverrides);
  }

  async function getTitleTrophies(authorization, npCommunicationId, trophyGroupId, options) {
    const url = buildRequestUrl(
      TROPHY_BASE_URL,
      '/v1/npCommunicationIds/:npCommunicationId/trophyGroups/:trophyGroupId/trophies',
      options,
      { npCommunicationId, trophyGroupId }
    );
    return await call(url, authorization, options?.headerOverrides);
  }

  async function getTitleTrophyGroups(authorization, npCommunicationId, options) {
    const url = buildRequestUrl(
      TROPHY_BASE_URL,
      '/v1/npCommunicationIds/:npCommunicationId/trophyGroups',
      options,
      { npCommunicationId }
    );
    return await call(url, authorization, options?.headerOverrides);
  }

  async function getUserTrophiesEarnedForTitle(authorization, accountId, npCommunicationId, trophyGroupId, options) {
    const url = buildRequestUrl(
      TROPHY_BASE_URL,
      '/v1/users/:accountId/npCommunicationIds/:npCommunicationId/trophyGroups/:trophyGroupId/trophies',
      options,
      { accountId, npCommunicationId, trophyGroupId }
    );
    const response = await call(url, authorization, options?.headerOverrides);
    if (response?.error) throw new Error(response.error.message ?? 'Unexpected Error');
    return response;
  }

  return {
    exchangeNpssoForCode,
    exchangeCodeForAccessToken,
    getProfileFromUserName,
    getUserTrophyProfileSummary,
    getUserTitles,
    getTitleTrophies,
    getTitleTrophyGroups,
    getUserTrophiesEarnedForTitle
  };
}
