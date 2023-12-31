import { logger } from '@sailpoint/connector-sdk'
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
const sleepfunction = (ms: number) => new Promise((r) => setTimeout(r, ms))
const validateStatus = (status: number) => {
    return (status >= 200 && status < 300) || status == 429
}

export class IDNClient {
    private readonly idnUrl?: string
    private readonly patId?: string
    private readonly patSecret?: string
    private readonly IDToken1?: string
    private readonly IDToken2?: string
    private readonly sailpointlogin?: string
    private accessToken?: string
    private accessToken1?: string
    private expiryDate: Date
    private expiryDate1: Date
    private batchSize: number

    constructor(config: any) {
        this.idnUrl = config.idnUrl
        this.patId = config.patId
        this.patSecret = config.patSecret
        this.IDToken1 = config.IDToken1
        this.IDToken2 = config.IDToken2
        this.sailpointlogin = config.sailpointlogin
        this.expiryDate = new Date()
        this.expiryDate1 = new Date()
        this.batchSize = 250
    }

    async getAccessToken(): Promise<string | undefined> {
        const url: string = '/oauth/token'
        if (new Date() >= this.expiryDate) {
            const request: AxiosRequestConfig = {
                method: 'post',
                baseURL: this.idnUrl,
                url,
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                params: {
                    client_id: this.patId,
                    client_secret: this.patSecret,
                    grant_type: 'client_credentials',
                },
            }
            logger.info('request is' + request.baseURL + request.url + request.params)
            const response: AxiosResponse = await axios(request)
            this.accessToken = response.data.access_token
            this.expiryDate = new Date()
            this.expiryDate.setSeconds(this.expiryDate.getSeconds() + response.data.expires_in)
        }

        return this.accessToken
    }

    async obtainAccessToken(): Promise<string | undefined> {
        const pm = require('postman-request')
        const cheerio = require('cheerio')
        if (new Date() >= this.expiryDate1) {
            // Use a Promise to obtain the access token
            const accessTokenPromise = new Promise<string>((resolve, reject) => {
                logger.info('the sailpoitnlogin url is' + this.sailpointlogin)
                pm.post(
                    {
                        url: this.sailpointlogin,
                        jar: true,
                        followAllRedirects: true,
                        removeRefererHeader: true,
                        form: {
                            IDToken1: this.IDToken1,
                            IDToken2: this.IDToken2,
                        },
                    },
                    function (err: any, response: any, body: any) {
                        if (err) {
                            reject(err)
                        } else {
                            const $ = cheerio.load(body)
                            const accessToken1 = $('script#slpt-globals-json').html()
                            resolve(JSON.parse(accessToken1 ?? '').api.accessToken)
                        }
                    }
                )
            })
            try {
                this.accessToken1 = await accessTokenPromise
                this.expiryDate1 = new Date()
                // Set expiry date to 15 minutes from now
                this.expiryDate1.setMinutes(this.expiryDate1.getMinutes() + 15)
            } catch (err) {
                console.error('Error obtaining access token:', err)
            }
        }

        return this.accessToken1
    }

    async testConnection(): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/v3/public-identities-config`

        let request: AxiosRequestConfig = {
            method: 'get',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        }

        return axios(request)
    }

    async *accountAggregation() {
        const accessToken = await this.getAccessToken()
        const url: string = `/v3/search`

        let request: AxiosRequestConfig = {
            method: 'post',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            params: {
                limit: this.batchSize,
                count: true,
            },
            data: {
                query: {
                    query: 'name:*',
                },
                sort: ['id'],
                indices: ['identities'],
                includeNested: true,
                queryResultFilter: {
                    includes: ['id', 'name'],
                },
            },
            validateStatus,
        }

        let pendingItems = true
        let processed = 0

        while (pendingItems) {
            let response = await axios(request)
            if (response.status === 429) {
                const retryAfter = parseInt(response.headers['retry-after']) * 1000
                console.log(`########## Retry after for accountAggregation ###########`)
                await sleepfunction(retryAfter)
            } else {
                const total = parseInt(response.headers['x-total-count'])
                processed += response.data.length
                console.log(`########## ${processed} ###########`)
                pendingItems = total > processed
                request.data.searchAfter = [response.data[response.data.length - 1]['id']]
                yield response
            }
        }
    }

    async getAccountDetails(id: string): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const encodedId = encodeURIComponent(id)
        const url: string = `/v2/identities/${encodedId}`

        let request: AxiosRequestConfig = {
            method: 'get',
            baseURL: this.idnUrl,
            url,
            validateStatus,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            params: null,
            data: null,
        }

        let response: AxiosResponse
        while (true) {
            response = await axios(request)
            if (response.status === 429) {
                const retryAfter = parseInt(response.headers['retry-after']) * 1000
                console.log(`########## Retry after for getAccountDetails ${id} ###########`)
                await sleepfunction(retryAfter)
            } else {
                return response
            }
        }

        return response
    }

    async getLCS(id: string): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/beta/identities/${id}`

        let request: AxiosRequestConfig = {
            method: 'get',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            params: null,
            data: null,
        }
        const response: AxiosResponse = await axios(request)
        return await response.data.attributes.cloudLifecycleState
    }

    async getAccountDetailsByName(name: string): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/v2/search/identities`

        let request: AxiosRequestConfig = {
            method: 'get',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            params: {
                query: `name:${name}`,
            },
            data: null,
        }

        return await axios(request)
    }

    async roleAggregation(): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/v3/search`

        let request: AxiosRequestConfig = {
            method: 'post',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            data: {
                query: {
                    query: 'source.name.exact:IdentityNow AND attribute:assignedGroups',
                },
                indices: ['entitlements'],
                includeNested: true,
                sort: ['name'],
            },
        }
        logger.info(request)
        return await axios(request)
    }

    async getRoleDetails(id: string): Promise<AxiosResponse> {
        logger.info('id value is ' + id)
        const accessToken = await this.getAccessToken()
        const url: string = `/v3/search`

        let request: AxiosRequestConfig = {
            method: 'post',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            params: null,
            data: {
                query: {
                    query: `source.name.exact:IdentityNow AND attribute:assignedGroups AND value:${id}`,
                },
                indices: ['entitlements'],
                includeNested: true,
                sort: ['name'],
            },
        }

        return await axios(request)
    }

    async workgroupAggregation(): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/v2/workgroups`

        let request: AxiosRequestConfig = {
            method: 'get',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
        }

        return await axios(request)
    }

    async getWorkgroup(id: string): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/v2/workgroups/${id}`

        let request: AxiosRequestConfig = {
            method: 'get',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
        }

        return await axios(request)
    }

    async getWorkgroupDetails(id: string): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/v2/workgroups/${id}/members`

        let request: AxiosRequestConfig = {
            method: 'get',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
        }

        return await axios(request)
    }

    async addRole(id: string, role: string[]): Promise<AxiosResponse> {
        const Token = await this.obtainAccessToken()
        const url: string = `/oathkeeper/auth-user-v3/auth-users/${id}`
        let request: AxiosRequestConfig = {
            method: 'patch',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${Token}`,
                'Content-Type': 'application/json-patch+json',
            },
            data: [{ op: 'replace', path: '/capabilities', value: role }],
        }

        return await axios(request)
    }

    async removeRole(id: string, role: string[]): Promise<AxiosResponse> {
        const Token = await this.obtainAccessToken()
        const url: string = `/oathkeeper/auth-user-v3/auth-users/${id}`
        let request: AxiosRequestConfig = {
            method: 'patch',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${Token}`,
                'Content-Type': 'application/json-patch+json',
            },
            data: [{ op: 'replace', path: '/capabilities', value: role }],
        }

        return await axios(request)
    }

    async addWorkgroup(id: string, workgroup: string): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/v2/workgroups/${workgroup}/members`

        let request: AxiosRequestConfig = {
            method: 'post',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            data: {
                add: [id],
                remove: [],
            },
        }

        return await axios(request)
    }

    async removeWorkgroup(id: string, workgroup: string): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/v2/workgroups/${workgroup}/members`

        let request: AxiosRequestConfig = {
            method: 'post',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            data: {
                add: [],
                remove: [id],
            },
        }

        return await axios(request)
    }

    async enableAccount(id: string): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/beta/identities-accounts/${id}/enable`

        let request: AxiosRequestConfig = {
            method: 'post',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            data: null,
        }

        return await axios(request)
    }

    async disableAccount(id: string): Promise<AxiosResponse> {
        const accessToken = await this.getAccessToken()
        const url: string = `/beta/identities-accounts/${id}/disable`

        let request: AxiosRequestConfig = {
            method: 'post',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            data: null,
        }
        return await axios(request)
    }

    async getCapabilties(id: string): Promise<string[] | undefined> {
        const Token = await this.obtainAccessToken()
        const url: string = `/oathkeeper/auth-user-v3/auth-users/${id}`
        let request: AxiosRequestConfig = {
            method: 'get',
            baseURL: this.idnUrl,
            url,
            headers: {
                Authorization: `Bearer ${Token}`,
            },
            data: null,
        }
        const response: AxiosResponse = await axios(request)
        return response.data.capabilities ?? []
    }
}
