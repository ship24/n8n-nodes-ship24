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
				path: 'ship24',
			},
		],
		properties: [
			{
				displayName:
					'Two URLs are shown above. Use the <strong>Test URL</strong> while building your workflow — click <em>Execute step</em> to start the node listening, then use the Ship24 dashboard test button to send a sample payload. Once your workflow is ready, <strong>activate</strong> it and copy the <strong>Production URL</strong> to save in <a href="https://dashboard.ship24.com/integrations/webhook" target="_blank">Ship24 Dashboard → Integrations → Webhook</a>. Ship24 will then send live tracking events to this workflow.',
				name: 'ship24WebhookNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName:
					'<strong>Webhook Secret (optional):</strong> Ship24 allocates a random secret to your account, visible in your dashboard. It is sent with every request as an <code>Authorization: Bearer your_webhook_secret</code> header. You can validate it in your workflow using an <em>IF</em> node that compares <code>{{ $request.headers.authorization }}</code> to your expected value, to ensure requests genuinely come from Ship24.',
				name: 'ship24WebhookSecretNotice',
				type: 'notice',
				default: '',
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
