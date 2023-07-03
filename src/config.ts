import isClientSide from 'src/isClientSide'
import logDebug from 'src/logDebug'
import { ConfigInput, ConfigMerged, defaultConfig } from './configTypes'

let config: ConfigMerged

const TWO_WEEKS_IN_MS = 14 * 60 * 60 * 24 * 1000

const validateConfig = (mergedConfig: ConfigMerged) => {
  const errorMessages = []

  // The config should have *either* a tokenChangedHandler *or* other
  // settings for login/logout.
  if (mergedConfig.tokenChangedHandler) {
    if (mergedConfig.loginAPIEndpoint) {
      errorMessages.push(
        'The "loginAPIEndpoint" setting should not be set if you are using a "tokenChangedHandler".'
      )
    }
    if (mergedConfig.logoutAPIEndpoint) {
      errorMessages.push(
        'The "logoutAPIEndpoint" setting should not be set if you are using a "tokenChangedHandler".'
      )
    }
    if (mergedConfig.onLoginRequestError) {
      errorMessages.push(
        'The "onLoginRequestError" setting should not be set if you are using a "tokenChangedHandler".'
      )
    }
    if (mergedConfig.onLogoutRequestError) {
      errorMessages.push(
        'The "onLogoutRequestError" setting should not be set if you are using a "tokenChangedHandler".'
      )
    }
  }

  // Require the public API key, which we use on the backend when
  // managing tokens.
  if (
    !(
      mergedConfig.firebaseClientInitConfig &&
      mergedConfig.firebaseClientInitConfig.apiKey
    )
  ) {
    errorMessages.push(
      `The "firebaseClientInitConfig.apiKey" value is required.`
    )
  }

  // Make sure the host address is set correctly.
  if (
    mergedConfig.firebaseAuthEmulatorHost &&
    mergedConfig.firebaseAuthEmulatorHost.startsWith('http')
  ) {
    errorMessages.push(
      'The firebaseAuthEmulatorHost should be set without a prefix (e.g., localhost:9099)'
    )
  }

  // Ensure error handlers are functions or undefined.
  const funcOrUndefArr = ['function', 'undefined']
  if (funcOrUndefArr.indexOf(typeof mergedConfig.onVerifyTokenError) < 0) {
    errorMessages.push(
      'Invalid next-firebase-auth options: The "onVerifyTokenError" setting must be a function.'
    )
  }
  if (funcOrUndefArr.indexOf(typeof mergedConfig.onTokenRefreshError) < 0) {
    errorMessages.push(
      'Invalid next-firebase-auth options: The "onTokenRefreshError" setting must be a function.'
    )
  }
  if (funcOrUndefArr.indexOf(typeof mergedConfig.onLoginRequestError) < 0) {
    errorMessages.push(
      'Invalid next-firebase-auth options: The "onLoginRequestError" setting must be a function.'
    )
  }
  if (funcOrUndefArr.indexOf(typeof mergedConfig.onLogoutRequestError) < 0) {
    errorMessages.push(
      'Invalid next-firebase-auth options: The "onLogoutRequestError" setting must be a function.'
    )
  }

  // We consider cookie keys undefined if the keys are an empty string,
  // empty array, or array of only undefined values.
  const { keys } = mergedConfig.cookies
  const areCookieKeysDefined = Array.isArray(keys)
    ? keys.length &&
      (keys.filter ? keys.filter((item) => item !== undefined).length : true)
    : !!keys

  // Validate config values that differ between client and server context.
  if (isClientSide()) {
    /**
     * START: config specific to client side
     */
    if (!mergedConfig.tokenChangedHandler) {
      if (!mergedConfig.loginAPIEndpoint) {
        errorMessages.push('The "loginAPIEndpoint" setting is required.')
      }
      if (!mergedConfig.logoutAPIEndpoint) {
        errorMessages.push('The "logoutAPIEndpoint" setting is required.')
      }
    }

    if (
      mergedConfig.firebaseAdminInitConfig &&
      mergedConfig.firebaseAdminInitConfig.credential &&
      mergedConfig.firebaseAdminInitConfig.credential.privateKey
    ) {
      errorMessages.push(
        'The "firebaseAdminInitConfig" private key setting should not be available on the client side.'
      )
    }
    if (areCookieKeysDefined) {
      errorMessages.push(
        'The "cookies.keys" setting should not be available on the client side.'
      )
    }
    /**
     * END: config specific to client side
     */
  } else {
    /**
     * START: config specific to server side
     */
    if (!mergedConfig.cookies.name) {
      errorMessages.push(
        'The "cookies.name" setting is required on the server side.'
      )
    }

    // Verify that the AUTH_EMULATOR_HOST_VARIABLE is set if the user has
    // provided the emulator host in the config.
    if (mergedConfig.firebaseAuthEmulatorHost) {
      if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        errorMessages.push(
          'The "FIREBASE_AUTH_EMULATOR_HOST" environment variable should be set if you are using the "firebaseAuthEmulatorHost" option'
        )
      } else if (
        process.env.FIREBASE_AUTH_EMULATOR_HOST !==
        mergedConfig.firebaseAuthEmulatorHost
      ) {
        errorMessages.push(
          'The "FIREBASE_AUTH_EMULATOR_HOST" environment variable should be the same as the host set in the config'
        )
      }
    }

    // Limit the max cookie age to two weeks for security. This matches
    // Firebase's limit for user identity cookies:
    // https://firebase.google.com/docs/auth/admin/manage-cookies
    // By default, the cookie will be refreshed each time the user loads
    // the client-side app.
    if (
      !mergedConfig.cookies.maxAge ||
      mergedConfig.cookies.maxAge > TWO_WEEKS_IN_MS
    ) {
      errorMessages.push(
        `The "cookies.maxAge" setting must be less than two weeks (${TWO_WEEKS_IN_MS} ms).`
      )
    }
    /**
     * END: config specific to server side
     */
  }

  return {
    isValid: errorMessages.length === 0,
    errors: errorMessages,
  }
}

// Replace private values with "hidden" for safer logging during
// debugging.
const replacePrivateValues = (unredactedConfig: ConfigInput) => {
  const redactedConfig = {
    ...unredactedConfig,
    cookies: {
      ...unredactedConfig.cookies,
      keys: ['hidden'],
    },
    ...(unredactedConfig.firebaseAdminInitConfig && {
      firebaseAdminInitConfig: {
        ...unredactedConfig.firebaseAdminInitConfig,
        ...(unredactedConfig.firebaseAdminInitConfig.credential && {
          credential: {
            ...unredactedConfig.firebaseAdminInitConfig.credential,
            privateKey: 'hidden',
            clientEmail: 'hidden',
          },
        }),
      },
    }),
  }
  return redactedConfig
}

export const setConfig = (userConfig: ConfigInput) => {
  logDebug(
    '[init] Setting config with provided value:',
    replacePrivateValues(userConfig)
  )

  const { cookies: cookieOptions, ...otherUserConfig } = userConfig

  // Merge the user's config with the default config, validate it,
  // and set it.
  const mergedConfig = {
    ...defaultConfig,
    ...otherUserConfig,
    cookies: {
      ...defaultConfig.cookies,
      ...(cookieOptions || {}),
    },
  }
  const { isValid, errors } = validateConfig(mergedConfig)
  if (!isValid) {
    throw new Error(`Invalid next-firebase-auth options: ${errors.join(' ')}`)
  }
  config = mergedConfig
}

export const getConfig = () => {
  if (!config) {
    throw new Error('next-firebase-auth must be initialized before rendering.')
  }
  return config
}