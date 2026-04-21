import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class Ship24Api implements ICredentialType {
	name = 'ship24Api';
	displayName = 'Ship24 API';
	icon: Icon = 'file:ship24.svg';
	documentationUrl = 'https://docs.ship24.com';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Ship24 API key. It will be sent as a Bearer token in the Authorization header.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{"Bearer " + $credentials.apiKey}}',
				Accept: 'application/json',
				'X-Source': 'n8n',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.ship24.com/public/v1',
			url: '/couriers',
			method: 'GET',
		},
	};
}