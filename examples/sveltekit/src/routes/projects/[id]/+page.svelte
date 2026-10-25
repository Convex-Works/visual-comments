<script lang="ts">
	import { page } from '$app/state';
</script>

<h1>Project {page.params.id}</h1>
<p>With <code>page="route"</code>, every project shares one set of threads: a comment here shows on each project.</p>
<table>
	<thead><tr><th>Task</th><th>Owner</th></tr></thead>
	<tbody>
		<tr><td>Design review</td><td>Ada</td></tr>
		<tr><td>Ship it</td><td>Grace</td></tr>
	</tbody>
</table>
