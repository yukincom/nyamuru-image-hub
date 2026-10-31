"""The Qwen prompt compiler shared by browser and CLI API jobs."""

def generation_prompt(config, english):
    roles = []
    multiple = len(config['references']) > 1
    correction = next((i for i, ref in enumerate(config['references'], 1) if ref['role'] == 'correction'), None)
    source = next((i for i, ref in enumerate(config['references'], 1) if ref['role'] in ('paint', 'sketch')), None)
    def image_name(index):
        return f'<image{index}>' if multiple else 'the supplied image'
    for i, ref in enumerate(config['references'], 1):
        if ref['role'] in ('paint', 'sketch'):
            if correction:
                roles.append(f'{image_name(i)}: the source image and canvas whose composition and untargeted content stay unchanged.')
            continue
        if ref['role'] == 'correction':
            roles.append(f'{image_name(i)}: ' + (
                f'drawn annotations or a separate mask locating the requested local edits on {image_name(source)}.' if source else
                'the annotated input image and canvas. Its marks and written instructions identify the requested local edits.'))
            continue
        name = f'<image{i}>' if multiple else 'The reference image'
        assignment = ''
        if config['owner_key'] in ('page', 'panel') and ref['character_keys']:
            characters = ', '.join(f'Character {config["character_keys"].index(key) + 1}' for key in ref['character_keys'])
            assignment = f'Assigned characters: {characters}. '
        roles.append(f"{name}: {english['references'][i-1]['label']}. {assignment}" +
                     ('Character identities and drawing styles.' if len(ref['character_keys']) > 1 else
                      'Character identity and drawing style; alternate views are one person, not extra people.'
                      if ref['character_keys'] else 'Drawing reference.'))
    if correction:
        instruction = (f'Edit {image_name(source or correction)} only as requested in the indicated regions. '
                       'Preserve the composition and all untargeted content. Remove the edit-guide marks and instruction text from the finished image.')
    elif config['mode'] == 'sketch':
        # The reviewed, editable storyboard prompt already contains the image roles.
        # Avoid a second competing editing instruction before the translated prompt.
        instruction = ''
        roles = []
    elif config['mode'] == 'paint':
        target = '<image1>' if multiple else 'the supplied painted image'
        instruction = f'Edit {target}. Preserve its pose and composition while completing the requested drawing.'
    else:
        instruction = ('Create a new drawing with the requested composition. Use the supplied images as references for the requested subject and style.'
                       if config['references'] else 'Create a new drawing with the requested composition.')
    prompt = ' '.join([instruction, *roles, english['prompt']])
    if not ((config['owner_key'] in ('page', 'panel') or config.get('content_kind') == 'handwritten') and config.get('literal_text')):
        prompt = ' '.join(prompt.split())
    if config['settings'].get('transparency_mode') == 'chroma-key-v1':
        color = config['settings']['chroma_key']['color']
        name = {'#00FF00': 'bright green', '#0000FF': 'pure blue', '#FF00FF': 'vivid magenta'}[color]
        prompt += (f' Use a flat, uniform, solid {name} background ({color}) for chroma key compositing. '
                   'Fill every visible background area with this same color, including gaps between the arms, legs, and strands of hair. '
                   'Do not add background gradients, texture, scenery, or cast shadows. '
                   "Keep the character's original colors unchanged, without tinting the character or its outlines with the background color. "
                   'Render an opaque image; transparency will be applied afterward.')
    elif config['settings'].get('transparency_mode') == 'code-white-v1':
        prompt += ' Use a plain white background for this finished illustration.'
    elif config['owner_key'] not in ('page', 'panel', 'background'):
        # Qwen's documented transparent-output format, independent of image inputs.
        prompt = 'This is an RGBA image with transparency. ' + prompt + ' The image has alpha channel and the background is transparent.'
    return prompt
