import fs from 'fs/promises'
import cp from 'child_process'
import path from 'path'
import util from 'util'

const exec = util.promisify(cp.exec)

const DEFAULT_POLL_INTERVAL = 2500

export interface Credentials {
  /**
   * The system port the LCU API is running on
   */
  port: number
  /**
   * The password for the LCU API
   */
  password: string
  /**
   * The system process id for the LeagueClientUx process
   */
  pid: number
  /**
   * Riot Games' self-signed root certificate (contents of .pem). If
   * it is `undefined` then unsafe authentication will be used.
   */
  certificate?: string
}

export interface AuthenticationOptions {
  /**
   * Does not return before the League Client has been detected. This means the
   * function stays unresolved until a League has been found.
   *
   * Defaults: false
   */
  awaitConnection?: boolean
  /**
   * The time duration in milliseconds between each attempt to locate a League
   * Client process. Has no effect if awaitConnection is false
   *
   * Default: 2500
   */
  pollInterval?: number
  /**
   * Riot Games' self-signed root certificate (contents of .pem)
   *
   * Default: version of certificate bundled in package
   */
  certificate?: string
  /**
   * Do not authenticate requests with Riot Games' self-signed root certificate
   *
   * Default: true if `certificate` is `undefined`
   */
  unsafe?: boolean
}

/**
 * Indicates that the application does not run on an environment that the
 * League Client supports. The Client runs on windows, linux or darwin.
 */
export class InvalidPlatformError extends Error {
  constructor() {
    super('process runs on platform client does not support')
  }
}

/**
 * Indicates that the league client could not be found
 */
export class ClientNotFoundError extends Error {
  constructor() {
    super('league client process could not be located')
  }
}

/**
 * Locates a League Client and retrieves the credentials for the LCU API
 * from the found process
 *
 * If options.awaitConnection is false the promise will resolve into a
 * rejection if a League Client is not running
 *
 * @param options {AuthenticationOptions} Authentication options, if any
 *
 * @throws InvalidPlatformError If the environment is not running
 * windows/linux/darwin
 */
export async function authenticate(options?: AuthenticationOptions): Promise<Credentials> {
  async function tryAuthenticate() {
    const portRegex = /--app-port=([0-9]+)/
    const passwordRegex = /--remoting-auth-token=([\w-_]+)/
    const pidRegex = /--app-pid=([0-9]+)/

    const command =
      process.platform === 'win32'
        ? "WMIC PROCESS WHERE name='LeagueClientUx.exe' GET CommandLine"
        : "ps x -o args | grep 'LeagueClientUx'"

    try {
      const { stdout } = await exec(command)
      const [, port] = stdout.match(portRegex)!
      const [, password] = stdout.match(passwordRegex)!
      const [, pid] = stdout.match(pidRegex)!
      const unsafe = options?.unsafe || typeof options?.unsafe === 'undefined'

      return {
        port: Number(port),
        pid: Number(pid),
        password,
        certificate:
          options?.certificate ||
          (unsafe ? undefined : await fs.readFile(path.join(__dirname, '..', 'riotgames.pem'), 'utf8'))
      }
    } catch {
      throw new ClientNotFoundError()
    }
  }

  // Does not run windows/linux/darwin
  if (!['win32', 'linux', 'darwin'].includes(process.platform)) {
    throw new InvalidPlatformError()
  }

  if (options?.awaitConnection) {
    // Poll until a client is found, attempting to resolve every
    // `options.pollInterval` milliseconds
    return new Promise(function self(resolve, reject) {
      tryAuthenticate()
        .then((result) => {
          resolve(result)
        })
        .catch((_) => {
          setTimeout(self, options?.pollInterval ?? DEFAULT_POLL_INTERVAL, resolve, reject)
        })
    })
  } else {
    return tryAuthenticate()
  }
}
