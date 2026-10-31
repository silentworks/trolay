<script lang="ts">
	import { liveQuery } from 'dexie';
	import { getPhoto } from '#lib/data/items.ts';

	interface Props {
		photoId: string;
		/** The 240 px thumbnail, or the full 1600 px photo. */
		size: 'thumb' | 'full';
		alt: string;
	}

	let { photoId, size, alt }: Props = $props();
	let url = $state<string>();

	// Photos are Blobs in IndexedDB; each is shown through an object URL released on change. A
	// partner's photo may arrive after the item does, so this follows the photo being stored.
	$effect(() => {
		let objectUrl: string | undefined;
		const subscription = liveQuery(() => getPhoto(photoId)).subscribe({
			next: (photo) => {
				if (objectUrl) URL.revokeObjectURL(objectUrl);
				objectUrl = photo
					? URL.createObjectURL(size === 'full' ? photo.blob : photo.thumbBlob)
					: undefined;
				url = objectUrl;
			},
			error: (error) => console.error(error)
		});
		return () => {
			subscription.unsubscribe();
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			url = undefined;
		};
	});
</script>

{#if url}
	<img src={url} {alt} class={size} />
{/if}

<style>
	img {
		display: block;
		border-radius: 8px;
	}

	.thumb {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.full {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
</style>
