import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class Ship24Api implements ICredentialType {
	name = 'ship24Api';

	displayName = 'Ship24 API';

	documentationUrl = 'https://docs.ship24.com';

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
