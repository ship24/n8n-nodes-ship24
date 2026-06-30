import type {
	IWebhookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class Ship24Trigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ship24 Trigger',
		name: 'ship24Trigger',
		icon: 'file:ship24.svg',
		group: ['trigger'],
		version: 1,
		description: 'Starts the workflow when Ship24 sends a tracking event to a webhook',
		defaults: { name: 'Ship24 Trigger' },
		subtitle: 'on tracking event',
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: '={{$parameter["path"]}}',
			},
		],
		properties: [
			{
				displayName:
					'<ul><li>Use the <strong>Test URL</strong> while building — click <em>Execute step</em> to start listening, then use the Ship24 dashboard test button.</li><li>When ready, <strong>activate</strong> the workflow and paste the <strong>Production URL</strong> into <a href="https://dashboard.ship24.com/integrations/webhook" target="_blank">Ship24 Dashboard → Integrations → Webhook</a>.</li><li><strong>Webhook Secret (optional):</strong> Ship24 sends your account secret as an <code>Authorization: Bearer</code> header. Validate it with an <em>IF</em> node comparing <code>{{ $request.headers.authorization }}</code> to your expected value.</li></ul>',
				name: 'ship24WebhookNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Webhook Path',
				name: 'path',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. shop-tracking',
				description: 'Unique slug for this webhook endpoint. Each active workflow must use a different path.',
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData();
		return {
			workflowData: [[{ json: body }]],
		};
	}
}
