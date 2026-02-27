import type { ICredentialType, INodeProperties, Icon, IHttpRequestMethods } from 'n8n-workflow';

export class Ship24Api implements ICredentialType {
	name = 'ship24Api';
	displayName = 'Ship24 API';
	icon: Icon = 'file:ship24.svg';
	documentationUrl = 'https://docs.ship24.com';

	test = {
		request: {
			baseURL: 'https://api.ship24.com/public/v1',
			url: '/couriers',
			method: 'GET' as IHttpRequestMethods,
		},
	};

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your Ship24 API key. It will be sent as a Bearer token in the Authorization header.',
		},
	];
}