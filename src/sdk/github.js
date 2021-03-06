import uuid from 'uuid/v5'

import { getQueryStringValue, rslError } from '../utils'

const GITHUB_API = 'https://api.github.com/graphql'

let oauth = false
let gatekeeperURL
let githubAccessToken
let githubAppId
let githubAuth
let githubRedirect

// Load fetch polyfill for browsers not supporting fetch API
if (!window.fetch) {
  require('whatwg-fetch')
}

/**
 * Fake Github SDK loading (needed to trick RSL into thinking its loaded).
 * @param {string} appId
 * @param {string} redirect
 * @param {string} gatekeeper
 */
const load = ({ appId, redirect, gatekeeper }) => new Promise((resolve, reject) => {
  if (!appId) {
    return reject(rslError({
      provider: 'github',
      type: 'load',
      description: 'Cannot load SDK without appId',
      error: null
    }))
  }

  githubAppId = appId

  if (gatekeeper) {
    gatekeeperURL = gatekeeper
    oauth = true
    githubRedirect = `${redirect}%3FrslCallback%3Dgithub`
    githubAuth = `http://github.com/login/oauth/authorize?client_id=${githubAppId}&redirect_uri=${githubRedirect}&scope=user&state=${uuid(redirect, uuid.URL)}`

    if (getQueryStringValue('rslCallback') === 'github') {
      getAccessToken()
        .then((accessToken) => {
          githubAccessToken = accessToken

          return resolve(githubAccessToken)
        })
        .catch(reject)
    } else {
      return resolve()
    }
  } else {
    return resolve()
  }
})

/**
 * Check if user is logged in to app through GitHub.
 * @see https://developer.github.com/apps/building-integrations/setting-up-and-registering-oauth-apps/about-authorization-options-for-oauth-apps/#redirect-urls
 */
const checkLogin = (autoLogin = false) => {
  if (autoLogin) {
    return login()
  }

  if (!githubAccessToken && oauth) {
    return Promise.reject(rslError({
      provider: 'github',
      type: 'access_token',
      description: 'No access token available',
      error: null
    }))
  }

  return new Promise((resolve, reject) => {
    window.fetch(GITHUB_API, {
      method: 'POST',
      headers: new Headers({
        'Authorization': `Bearer ${githubAccessToken || githubAppId}`
      }),
      body: JSON.stringify({query: 'query { viewer { id, name, email, avatarUrl } }'})
    })
      .then((response) => response.json())
      .then((json) => {
        if (json.message || json.errors) {
          return reject(rslError({
            provider: 'github',
            type: 'check_login',
            description: 'Failed to fetch user data',
            error: json
          }))
        }

        return resolve(json)
      })
      .catch(() => reject(rslError({
        provider: 'github',
        type: 'check_login',
        description: 'Failed to fetch user data due to window.fetch() error',
        error: null
      })))
  })
}

/**
 * Trigger GitHub login process.
 * This code only triggers login request, response is handled by a callback handled on SDK load.
 * @see https://developer.github.com/apps/building-integrations/setting-up-and-registering-oauth-apps/about-authorization-options-for-oauth-apps
 */
const login = () => new Promise((resolve, reject) => {
  checkLogin()
    .then((response) => resolve(response))
    .catch((error) => {
      if (!oauth) {
        return reject(error)
      }

      window.open(githubAuth, '_self')
    })
})

/**
 * Get access token with authorization code
 * @see https://github.com/prose/gatekeeper
 * @see https://developer.github.com/apps/building-integrations/setting-up-and-registering-oauth-apps/about-authorization-options-for-oauth-apps
 */
const getAccessToken = () => new Promise((resolve, reject) => {
  const authorizationCode = getQueryStringValue('code')

  if (!authorizationCode) {
    return reject('Authorization code not found')
  }

  window.fetch(`${gatekeeperURL}/authenticate/${authorizationCode}`)
    .then((response) => response.json())
    .then((json) => {
      if (json.error || !json.token) {
        return reject(rslError({
          provider: 'github',
          type: 'access_token',
          description: 'Got error from fetch access token',
          error: json
        }))
      }

      return resolve(json.token)
    })
    .catch((error) => reject(rslError({
      provider: 'github',
      type: 'access_token',
      description: 'Failed to fetch user data due to window.fetch() error',
      error
    })))
})

/**
 * Helper to generate user account data.
 * @param {Object} viewer
 */
const generateUser = ({ data: { viewer } }) => {
  return {
    profile: {
      id: viewer.id,
      name: viewer.name,
      firstName: viewer.name,
      lastName: viewer.name,
      email: viewer.email,
      profilePicURL: viewer.avatarUrl
    },
    token: {
      accessToken: githubAccessToken || githubAppId,
      expiresAt: Infinity // Couldn’t find a way to get expiration time
    }
  }
}

export default {
  checkLogin,
  generateUser,
  load,
  login
}
