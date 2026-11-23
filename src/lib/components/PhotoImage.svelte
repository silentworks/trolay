<script lang="ts">
	import { liveQuery } from 'dexie';
	import { getPhoto } from '#lib/data/items.ts';

	interface Props {
		photoId: string;
		/** The 240 px thumbnail, or the full 1600 px photo. */
		size: 'thumb' | 'full';
		alt: string;
		/**
		 * When this phone doesn't have the photo, show the copy kept in the cloud, if there is one
		 * (only for someone signed in).
		 */
		cloud?: boolean;
		/** Neither this phone nor the cloud has the photo. */
		onmissing?: () => void;
		/** Told where the photo shown is (for downloading it), and again when that changes. */
		onshown?: (src: string | undefined) => void;
	}

	let { photoId, size, alt, cloud = false, onmissing, onshown }: Props = $props();
	let url = $state<string>();
	/** This phone has been asked, and has no copy. */
	let notHere = $state(false);
	/** Nor has the cloud. */
	let gone = $state(false);
	const shown = $derived(
		url ??
			(cloud && notHere && !gone ? `/api/kept-photos/${encodeURIComponent(photoId)}` : undefined)
	);
	$effect(() => onshown?.(shown));

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
				notHere = !photo;
				if (!photo && !cloud) onmissing?.();
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

{#if shown}
	<img
		src={shown}
		{alt}
		class={size}
		onerror={() => {
			// The cloud has no copy either.
			if (!url) {
				gone = true;
				onmissing?.();
			}
		}}
	/>
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
