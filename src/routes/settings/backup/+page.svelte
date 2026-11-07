<script lang="ts">
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import BackupPanel from '#lib/components/BackupPanel.svelte';
</script>

<svelte:head>
	<title>Backup & restore · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="Backup & restore" back={{ href: resolve('/settings'), label: 'Settings' }} />
	<BackupPanel />
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}
</style>
