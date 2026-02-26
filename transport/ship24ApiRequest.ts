import type {
	IExecuteFunctions,
	IDataObject,
	IHttpRequestOptions,
	IHttpRequestMethods,
} from 'n8n-workflow';

const BASE_URL = 'https://api.ship24.com/public/v1';

export async function ship24ApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject | IDataObject[],
	qs?: IDataObject,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('ship24Api');

	const url =
		path.startsWith('http')
			? path
			: `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;

	const options: IHttpRequestOptions = {
		method,
		url,
		headers: {
			Authorization: `Bearer ${credentials.apiKey as string}`,
			Accept: 'application/json',
		},
		json: true,
	};

	if (qs && Object.keys(qs).length > 0) {
		options.qs = qs;
	}

	// Only attach body when it makes sense (avoid GET/DELETE bodies)
	const methodUpper = String(method).toUpperCase();
	if (body !== undefined && !['GET', 'DELETE'].includes(methodUpper)) {
		options.body = body;

		// Safe to set Content-Type when we actually send a body
		options.headers = {
			...(options.headers ?? {}),
			'Content-Type': 'application/json',
		};
	}

	return (await this.helpers.httpRequest(options)) as IDataObject;
}