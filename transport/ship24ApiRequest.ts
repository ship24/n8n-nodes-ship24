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
	const url =
		path.startsWith('http')
			? path
			: `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;

	const options: IHttpRequestOptions = {
		method,
		url,
		headers: {
			Accept: 'application/json',
		},
		json: true,
	};

	if (qs && Object.keys(qs).length > 0) {
		options.qs = qs;
	}

	const methodUpper = String(method).toUpperCase();
	if (body !== undefined && !['GET', 'DELETE'].includes(methodUpper)) {
		options.body = body;

		options.headers = {
			...(options.headers ?? {}),
			'Content-Type': 'application/json',
		};
	}

	return (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'ship24Api',
		options,
	)) as IDataObject;
}