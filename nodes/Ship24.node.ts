import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { ship24ApiRequest } from '../transport/ship24ApiRequest';

type Ship24ErrorContext = {
	resource?: string;
	operation?: string;
	trackingNumber?: string;
	trackerId?: string;
	path?: string;
	itemIndex?: number;
};

function formatShip24HttpError(
	error: any,
	ctx: Ship24ErrorContext = {},
): { message: string; description?: string } {
	// n8n httpRequest errors can expose status in different places depending on runtime / helper
	const rawStatusCode =
		error?.statusCode ??
		error?.response?.status ??
		error?.response?.statusCode ??
		error?.httpCode ??
		error?.cause?.statusCode ??
		error?.cause?.response?.status ??
		error?.cause?.response?.statusCode ??
		error?.cause?.httpCode;

	const statusCode =
		typeof rawStatusCode === 'string'
			? Number.parseInt(rawStatusCode, 10)
			: typeof rawStatusCode === 'number'
				? rawStatusCode
				: undefined;

	const statusText =
		error?.response?.statusText ?? (statusCode ? `HTTP ${statusCode}` : undefined);

	const responseBody =
		error?.response?.body ??
		error?.response?.data ??
		error?.body ??
		error?.data ??
		error?.cause?.response?.body ??
		error?.cause?.response?.data ??
		error?.cause?.body ??
		error?.cause?.data;

	let ship24Message: string | undefined;

	if (responseBody && typeof responseBody === 'object') {
		ship24Message =
			(responseBody.message as string) ||
			(responseBody.error as string) ||
			(responseBody.title as string);
	} else if (typeof responseBody === 'string' && responseBody.trim() !== '') {
		ship24Message = responseBody.trim();
	}

	const itemPrefix =
		typeof ctx.itemIndex === 'number' ? `Item ${ctx.itemIndex + 1}: ` : '';

	if (statusCode === 401) {
		return {
			message: `${itemPrefix}Ship24 API request failed (401). Check your API key credentials.`,
			description: ship24Message ? `Ship24 response: ${ship24Message}` : undefined,
		};
	}

	if (statusCode === 404) {
		let message = `${itemPrefix}Ship24 API request failed (404). The requested resource was not found.`;

		if (ctx.resource === 'tracker' && ctx.operation === 'getResultsByTrackerId') {
			message =
				`${itemPrefix}Ship24 API request failed (404). No results found for this tracker ID (or it is not available yet).`;
		} else if (ctx.resource === 'tracker' && ctx.operation === 'getResultsByTrackingNumber') {
			message =
				`${itemPrefix}Ship24 API request failed (404). No results found for this tracking number (or it is not available yet).`;
		} else if (ctx.resource === 'utility' && ctx.operation === 'apiCall') {
			message = `${itemPrefix}Ship24 API request failed (404). The API path may be incorrect.`;
		}

		return {
			message,
			description: ship24Message ? `Ship24 response: ${ship24Message}` : undefined,
		};
	}

	if (statusCode === 429) {
		return {
			message:
				`${itemPrefix}Ship24 API request failed (429). Rate limit exceeded. Try again later or reduce request frequency.`,
			description: ship24Message ? `Ship24 response: ${ship24Message}` : undefined,
		};
	}

	const baseMessage = ship24Message
		? `${itemPrefix}Ship24 API request failed (${statusText ?? 'error'}): ${ship24Message}`
		: `${itemPrefix}Ship24 API request failed (${statusText ?? 'error'}).`;

	let description: string | undefined;
	if (responseBody !== undefined) {
		try {
			description = `Ship24 response body:\n${
				typeof responseBody === 'string'
					? responseBody
					: JSON.stringify(responseBody, null, 2)
			}`;
		} catch {
			description = 'Ship24 response body was present but could not be stringified.';
		}
	}

	return { message: baseMessage, description };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

function normaliseTrackingNumber(v: unknown): string {
	if (typeof v !== 'string') return '';
	return v.trim();
}

function parseCourierCodes(input: unknown): string[] | undefined {
	if (typeof input !== 'string') return undefined;
	const trimmed = input.trim();
	if (!trimmed) return undefined;

	const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
	return parts.length ? parts : undefined;
}

function getFixedCollectionValues(collection: IDataObject | undefined): IDataObject | undefined {
	if (!collection || typeof collection !== 'object') return undefined;
	const values = (collection as IDataObject).values;
	if (values && typeof values === 'object') return values as IDataObject;
	return undefined;
}

function isUuid(v: unknown): boolean {
	if (typeof v !== 'string') return false;
	const s = v.trim();
	const uuidV4ish =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidV4ish.test(s);
}

function buildCreatePayload(
	trackingNumber: string,
	additionalFields: IDataObject | undefined,
): IDataObject {
	const body: IDataObject = { trackingNumber };
	const af = additionalFields ?? {};

	const setIfString = (key: string) => {
		const v = af[key];
		if (typeof v === 'string' && v.trim() !== '') body[key] = v.trim();
	};

	setIfString('shipmentReference');
	setIfString('clientTrackerId');
	setIfString('originCountryCode');
	setIfString('destinationCountryCode');
	setIfString('destinationPostCode');
	setIfString('courierName');
	setIfString('trackingUrl');
	setIfString('orderNumber');

	if (typeof af.shippingDate === 'string' && af.shippingDate.trim() !== '') {
		body.shippingDate = af.shippingDate.trim();
	}

	if (typeof af.courierCode === 'string') {
		const codes = parseCourierCodes(af.courierCode);
		if (codes) body.courierCode = codes;
	}

	const recipient = getFixedCollectionValues(af.recipient as IDataObject | undefined);
	if (recipient) {
		const email = recipient.email;
		if (typeof email === 'string' && email.trim() !== '') {
			body.recipient = { email: email.trim() };
		}
	}

	const settings = getFixedCollectionValues(af.settings as IDataObject | undefined);
	if (settings) {
		const restrict = settings.restrictTrackingToCourierCode;
		if (typeof restrict === 'boolean') {
			body.settings = { restrictTrackingToCourierCode: restrict };
		}
	}

	return body;
}

function bulkFirstErrorMessage(errors: unknown): { code?: string; message?: string } {
	if (!Array.isArray(errors) || errors.length === 0) return {};
	const first = errors[0] as any;
	return {
		code: typeof first?.code === 'string' ? first.code : undefined,
		message: typeof first?.message === 'string' ? first.message : undefined,
	};
}

export class Ship24 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ship24',
		name: 'ship24',
		icon: 'file:ship24.svg',
		group: ['input'],
		version: 1,
		description: 'Automate shipment tracking using the Ship24 API',
		defaults: { name: 'Ship24' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ship24Api', required: true }],
		properties: [
			{
				displayName:
					'Generate or view your Ship24 API key in the dashboard: https://dashboard.ship24.com/integrations/api-keys',
				name: 'ship24DashboardNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Tracker', value: 'tracker' },
					{ name: 'Utility', value: 'utility' },
				],
				default: 'tracker',
			},

			// ---- TRACKER OPS ----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Create', value: 'create' },
					{ name: 'Create and Get Results', value: 'createAndGetResults' },
					{ name: 'Update', value: 'update' },
					{ name: 'Get Results By Tracking Number', value: 'getResultsByTrackingNumber' },
					{ name: 'Get Results By Tracker ID', value: 'getResultsByTrackerId' },
				],
				displayOptions: { show: { resource: ['tracker'] } },
				default: 'create',
			},

			// ---- UTILITY OPS ----
			{
				displayName: 'Operation',
				name: 'utilityOperation',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Make an API Call', value: 'apiCall' }],
				displayOptions: { show: { resource: ['utility'] } },
				default: 'apiCall',
			},

			// ---- CREATE CONFIG ----
			{
				displayName: 'Create Method',
				name: 'createMethod',
				type: 'options',
				default: 'single',
				options: [
					{ name: 'Single (Per Item)', value: 'single' },
					{ name: 'Bulk (Up to 100 per request)', value: 'bulk' },
				],
				description:
					'When using Bulk, the node batches input items (max 100 tracking numbers per API request) and returns one output item per input item.',
				displayOptions: { show: { resource: ['tracker'], operation: ['create'] } },
			},
			{
				displayName: 'Tracking Number',
				name: 'trackingNumber',
				type: 'string',
				required: true,
				default: '',
				placeholder: '07284069305508',
				description: 'The shipment tracking number.',
				displayOptions: {
					show: {
						resource: ['tracker'],
						operation: ['create', 'createAndGetResults', 'getResultsByTrackingNumber'],
					},
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				default: {},
				placeholder: 'Add Field',
				description: 'Optional fields for creating a tracker.',
				displayOptions: {
					show: {
						resource: ['tracker'],
						operation: ['create', 'createAndGetResults'],
					},
				},
				options: [
					{
						displayName: 'Shipment Reference',
						name: 'shipmentReference',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Client Tracker ID',
						name: 'clientTrackerId',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Origin Country Code',
						name: 'originCountryCode',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Destination Country Code',
						name: 'destinationCountryCode',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Destination Post Code',
						name: 'destinationPostCode',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Shipping Date',
						name: 'shippingDate',
						type: 'string',
						default: '',
						placeholder: '2021-03-01T11:09:00.000Z',
						description: 'ISO date-time string (UTC).',
					},
					{
						displayName: 'Courier Code',
						name: 'courierCode',
						type: 'string',
						default: '',
						placeholder: 'mobly or mobly,usps',
						description: 'Comma-separated courier codes (supports expressions and mapping).',
					},
					{
						displayName: 'Courier Name',
						name: 'courierName',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Tracking URL',
						name: 'trackingUrl',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Order Number',
						name: 'orderNumber',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Recipient',
						name: 'recipient',
						type: 'fixedCollection',
						default: {},
						options: [
							{
								displayName: 'Recipient',
								name: 'values',
								values: [{ displayName: 'Email', name: 'email', type: 'string', default: '' }],
							},
						],
					},
					{
						displayName: 'Settings',
						name: 'settings',
						type: 'fixedCollection',
						default: {},
						options: [
							{
								displayName: 'Settings',
								name: 'values',
								values: [
									{
										displayName: 'Restrict Tracking To Courier Code',
										name: 'restrictTrackingToCourierCode',
										type: 'boolean',
										default: false,
									},
								],
							},
						],
					},
				],
			},

			// ---- TRACKER ID (RESULTS / UPDATE) ----
			{
				displayName: 'Tracker ID',
				name: 'trackerId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'a6e6c40c-e012-4832-9636-e73ffda82517',
				description: 'The Ship24 tracker ID (UUID).',
				displayOptions: {
					show: {
						resource: ['tracker'],
						operation: ['getResultsByTrackerId', 'update'],
					},
				},
			},

			// ---- UPDATE ----
			{
				displayName: 'Is Subscribed',
				name: 'isSubscribed',
				type: 'boolean',
				default: true,
				description: 'Whether the tracker is subscribed for updates.',
				displayOptions: {
					show: {
						resource: ['tracker'],
						operation: ['update'],
					},
				},
			},
			{
				displayName: 'Origin Country Code',
				name: 'originCountryCode',
				type: 'string',
				default: '',
				placeholder: 'CN',
				description: 'Two-letter country code (ISO 3166-1 alpha-2).',
				displayOptions: {
					show: {
						resource: ['tracker'],
						operation: ['update'],
					},
				},
			},
			{
				displayName: 'Destination Country Code',
				name: 'destinationCountryCode',
				type: 'string',
				default: '',
				placeholder: 'US',
				description: 'Two-letter country code (ISO 3166-1 alpha-2).',
				displayOptions: {
					show: {
						resource: ['tracker'],
						operation: ['update'],
					},
				},
			},
			{
				displayName: 'Destination Post Code',
				name: 'destinationPostCode',
				type: 'string',
				default: '',
				placeholder: '94901',
				displayOptions: {
					show: {
						resource: ['tracker'],
						operation: ['update'],
					},
				},
			},
			{
				displayName: 'Shipping Date',
				name: 'shippingDate',
				type: 'string',
				default: '',
				placeholder: '2021-03-01T11:09:00.000Z',
				description: 'Shipping date in ISO format (UTC recommended).',
				displayOptions: {
					show: {
						resource: ['tracker'],
						operation: ['update'],
					},
				},
			},
			{
				displayName: 'Courier Code',
				name: 'courierCode',
				type: 'string',
				default: '',
				placeholder: 'us-post',
				description: 'Comma-separated courier codes (e.g. "us-post,dhl").',
				displayOptions: {
					show: {
						resource: ['tracker'],
						operation: ['update'],
					},
				},
			},

			// ---- UTILITY FIELDS ----
			{
				displayName: 'Method',
				name: 'method',
				type: 'options',
				options: [
					{ name: 'DELETE', value: 'DELETE' },
					{ name: 'GET', value: 'GET' },
					{ name: 'PATCH', value: 'PATCH' },
					{ name: 'POST', value: 'POST' },
					{ name: 'PUT', value: 'PUT' },
				],
				displayOptions: { show: { resource: ['utility'] } },
				default: 'GET',
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				required: true,
				default: '',
				placeholder: '/trackers',
				description: 'Relative Ship24 API path.',
				displayOptions: { show: { resource: ['utility'] } },
			},
			{
				displayName: 'Query Parameters',
				name: 'query',
				type: 'json',
				default: '{}',
				displayOptions: { show: { resource: ['utility'] } },
			},
			{
				displayName: 'Body',
				name: 'body',
				type: 'json',
				default: '{}',
				displayOptions: { show: { resource: ['utility'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const pushItemError = (error: any, ctx: Ship24ErrorContext) => {
			const formatted = formatShip24HttpError(error, ctx);

			if (this.continueOnFail()) {
				returnData.push({
					json: {
						success: false,
						error: {
							message: formatted.message,
							description: formatted.description,
						},
						context: {
							resource: ctx.resource,
							operation: ctx.operation,
							trackingNumber: ctx.trackingNumber,
							trackerId: ctx.trackerId,
							path: ctx.path,
							itemIndex: ctx.itemIndex,
						},
					},
				});
				return;
			}

			throw new NodeOperationError(
				this.getNode(),
				formatted.message,
				formatted.description ? { description: formatted.description } : undefined,
			);
		};

		// Bulk is only valid when ALL items are tracker+create+bulk
		const canBulkCreateAllItems = (() => {
			if (items.length === 0) return false;
			try {
				for (let i = 0; i < items.length; i++) {
					const r = this.getNodeParameter('resource', i) as string;
					if (r !== 'tracker') return false;

					const op = this.getNodeParameter('operation', i) as string;
					if (op !== 'create') return false;

					const m = (this.getNodeParameter('createMethod', i) as string) || 'single';
					if (m !== 'bulk') return false;
				}
				return true;
			} catch {
				return false;
			}
		})();

		// ---- BULK CREATE ----
		if (canBulkCreateAllItems) {
			const indexed = items.map((_, i) => {
				const trackingNumber = normaliseTrackingNumber(
					this.getNodeParameter('trackingNumber', i) as string,
				);
				const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
				return { i, trackingNumber, additionalFields };
			});

			const chunks = chunkArray(indexed, 100);
			const outputs: Array<IDataObject | undefined> = new Array(items.length);

			for (const chunk of chunks) {
				const bulkBody = chunk.map((x) => buildCreatePayload(x.trackingNumber, x.additionalFields));

				try {
					const response = await ship24ApiRequest.call(this, 'POST', '/trackers/bulk', bulkBody);

					const bulkMeta: IDataObject = {
						status: (response as any)?.status,
						summary: (response as any)?.summary,
					};

					const dataItems: any[] = Array.isArray((response as any)?.data)
						? ((response as any).data as any[])
						: [];

					const map = new Map<string, any[]>();
					for (const d of dataItems) {
						const tn = normaliseTrackingNumber(d?.inputData?.trackingNumber);
						if (!tn) continue;
						if (!map.has(tn)) map.set(tn, []);
						map.get(tn)!.push(d);
					}

					for (const input of chunk) {
						const tn = input.trackingNumber;
						const queue = map.get(tn);
						const itemResult = queue?.shift();

						if (!itemResult) {
							outputs[input.i] = {
								success: false,
								trackingNumber: tn,
								error: {
									type: 'mapping_error',
									message: 'No result returned for this tracking number in the bulk response.',
								},
								_bulk: bulkMeta,
							};
							continue;
						}

						const itemStatus = itemResult?.itemStatus as string | undefined;

						if (itemStatus === 'error') {
							const firstErr = bulkFirstErrorMessage(itemResult?.errors);

							outputs[input.i] = {
								success: false,
								trackingNumber: tn,
								itemStatus,
								error: {
									type: 'item_error',
									code: firstErr.code,
									message: firstErr.message ?? 'An error occurred for this tracking number.',
								},
								errors: itemResult?.errors ?? null,
								inputData: itemResult?.inputData ?? null,
								tracker: itemResult?.tracker ?? null,
								_bulk: bulkMeta,
							};
						} else {
							outputs[input.i] = {
								success: true,
								trackingNumber: tn,
								itemStatus,
								tracker: itemResult?.tracker ?? null,
								inputData: itemResult?.inputData ?? null,
								errors: itemResult?.errors ?? null,
								_bulk: bulkMeta,
							};
						}
					}
				} catch (error) {
					const formatted = formatShip24HttpError(error, {
						resource: 'tracker',
						operation: 'create',
					});

					if (!this.continueOnFail()) {
						throw new NodeOperationError(
							this.getNode(),
							formatted.message,
							formatted.description ? { description: formatted.description } : undefined,
						);
					}

					for (const x of chunk) {
						outputs[x.i] = {
							success: false,
							trackingNumber: x.trackingNumber,
							error: {
								type: 'request_error',
								message: formatted.message,
								description: formatted.description,
							},
						};
					}
				}
			}

			for (let i = 0; i < outputs.length; i++) {
				returnData.push({
					json:
						outputs[i] ??
						{
							success: false,
							error: { type: 'unknown', message: 'No output generated for this item.' },
						},
				});
			}

			return [returnData];
		}

		// ---- PER-ITEM MULTI-ITEM SUPPORT ----
		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;

			// ---- TRACKER ----
			if (resource === 'tracker') {
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation === 'create') {
					const trackingNumber = normaliseTrackingNumber(
						this.getNodeParameter('trackingNumber', i) as string,
					);
					const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
					const body = buildCreatePayload(trackingNumber, additionalFields);

					try {
						const response = await ship24ApiRequest.call(this, 'POST', '/trackers', body);
						returnData.push({ json: response as IDataObject });
						continue;
					} catch (error) {
						pushItemError(error, { resource, operation, trackingNumber, itemIndex: i });
						continue;
					}
				}

				if (operation === 'createAndGetResults') {
					const trackingNumber = normaliseTrackingNumber(
						this.getNodeParameter('trackingNumber', i) as string,
					);
					const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
					const body = buildCreatePayload(trackingNumber, additionalFields);

					try {
						const created = await ship24ApiRequest.call(this, 'POST', '/trackers', body);

						const trackerId =
							((created as any)?.data?.tracker?.trackerId as string | undefined) ??
							((created as any)?.tracker?.trackerId as string | undefined);

						if (!trackerId || typeof trackerId !== 'string') {
							throw new NodeOperationError(
								this.getNode(),
								'Create succeeded but trackerId was not found in the response.',
							);
						}

						const results = await ship24ApiRequest.call(
							this,
							'GET',
							`/trackers/${encodeURIComponent(trackerId)}/results`,
						);

						returnData.push({
							json: {
								created,
								results,
							} as IDataObject,
						});
						continue;
					} catch (error) {
						pushItemError(error, { resource, operation, trackingNumber, itemIndex: i });
						continue;
					}
				}

				if (operation === 'update') {
					const trackerId = this.getNodeParameter('trackerId', i) as string;

					if (!isUuid(trackerId)) {
						pushItemError(
							new NodeOperationError(this.getNode(), 'Tracker ID must be a valid UUID.'),
							{ resource, operation, trackerId, itemIndex: i },
						);
						continue;
					}

					const body: IDataObject = {};

					body.isSubscribed = this.getNodeParameter('isSubscribed', i) as boolean;

					const originCountryCode = this.getNodeParameter('originCountryCode', i, '') as string;
					if (typeof originCountryCode === 'string' && originCountryCode.trim() !== '') {
						body.originCountryCode = originCountryCode.trim();
					}

					const destinationCountryCode = this.getNodeParameter('destinationCountryCode', i, '') as string;
					if (typeof destinationCountryCode === 'string' && destinationCountryCode.trim() !== '') {
						body.destinationCountryCode = destinationCountryCode.trim();
					}

					const destinationPostCode = this.getNodeParameter('destinationPostCode', i, '') as string;
					if (typeof destinationPostCode === 'string' && destinationPostCode.trim() !== '') {
						body.destinationPostCode = destinationPostCode.trim();
					}

					const shippingDate = this.getNodeParameter('shippingDate', i, '') as string;
					if (typeof shippingDate === 'string' && shippingDate.trim() !== '') {
						body.shippingDate = shippingDate.trim();
					}

					const courierCodeRaw = this.getNodeParameter('courierCode', i, '') as string;
					if (typeof courierCodeRaw === 'string' && courierCodeRaw.trim() !== '') {
						const codes = parseCourierCodes(courierCodeRaw);
						if (codes) body.courierCode = codes;
					}

					try {
						const response = await ship24ApiRequest.call(
							this,
							'PATCH',
							`/trackers/${encodeURIComponent(trackerId)}`,
							body,
						);

						returnData.push({ json: response as IDataObject });
						continue;
					} catch (error) {
						pushItemError(error, { resource, operation, trackerId, itemIndex: i });
						continue;
					}
				}

				if (operation === 'getResultsByTrackingNumber') {
					const trackingNumber = normaliseTrackingNumber(
						this.getNodeParameter('trackingNumber', i) as string,
					);
					try {
						const response = await ship24ApiRequest.call(
							this,
							'GET',
							`/trackers/search/${encodeURIComponent(trackingNumber)}/results`,
						);
						returnData.push({ json: response as IDataObject });
						continue;
					} catch (error) {
						pushItemError(error, { resource, operation, trackingNumber, itemIndex: i });
						continue;
					}
				}

				if (operation === 'getResultsByTrackerId') {
					const trackerId = this.getNodeParameter('trackerId', i) as string;

					if (!isUuid(trackerId)) {
						pushItemError(
							new NodeOperationError(this.getNode(), 'Tracker ID must be a valid UUID.'),
							{ resource, operation, trackerId, itemIndex: i },
						);
						continue;
					}

					try {
						const response = await ship24ApiRequest.call(
							this,
							'GET',
							`/trackers/${encodeURIComponent(trackerId)}/results`,
						);
						returnData.push({ json: response as IDataObject });
						continue;
					} catch (error) {
						pushItemError(error, { resource, operation, trackerId, itemIndex: i });
						continue;
					}
				}

				pushItemError(new Error('The selected operation is not implemented.'), {
					resource,
					operation,
					itemIndex: i,
				});
				continue;
			}

			// ---- UTILITY ----
			if (resource === 'utility') {
				const operation = (this.getNodeParameter('utilityOperation', i) as string) || 'apiCall';
				try {
					const method = this.getNodeParameter('method', i) as any;
					const path = this.getNodeParameter('path', i) as string;
					const query = this.getNodeParameter('query', i) as IDataObject;
					const body = this.getNodeParameter('body', i) as IDataObject;

					const response = await ship24ApiRequest.call(this, method, path, body, query);
					returnData.push({ json: response as IDataObject });
					continue;
				} catch (error) {
					pushItemError(error, {
						resource,
						operation,
						path: this.getNodeParameter('path', i) as string,
						itemIndex: i,
					});
					continue;
				}
			}

			pushItemError(new Error('The selected resource is not implemented.'), {
				resource,
				itemIndex: i,
			});
		}

		return [returnData];
	}
}