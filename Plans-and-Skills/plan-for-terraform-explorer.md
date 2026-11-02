# Plan for creating Terraform relationship explorer. 


## Goal for this project. 


The goal for this project is to create tool that will map terraform dependancy relationsships in the AWS hashicorp/aws registry [Here](https://registry.terraform.io/providers/hashicorp/aws/latest)


The end result will:

* Be an interactive tool that:


    * allows users to explore dependancies and relationships between resources in the [hashicorp/awsregistry](https://registry.terraform.io/providers/hashicorp/aws/latest)  


    * As an example a resource like [aws_vpc](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/vpc) might show that it has no required resources - but that aws_subnet and aws_security_group are dependant on the above resource.  


    * The display will be in an interactive tree structure when you select a resource it will show with lines the required and depedant resources. When selecting these resources the tree will rearrange to focus on the selected resource and map it's required and dependant resources.   


    * The trees elements will have be like bubbles and new branches will "pop"  below selected branches. This will not be sudden and jarring to the user it will be smooth and comforting.


    * Reqired and dependant resources will be grouped in branches of similar resources, as linked in the hashicorp/aws registry. Where these resources are too numerous to show comfortably the branch will open to reveal these resources when clicked and have a clearly visible way of closing these branches. 


    * the colour structure will mimic that of the "abyss" theme in vscode. 


    * There will be a search function to locate resources. 


    * There will be an option of showing history of selected resources so that users can trace the path of dependancies from a "root" down to a final branch.  


    * There will be a tool to reset the trees back to a search bubbble at the beginning if users want to start again.


    * Users will be able to save searches and selections for the current session in a list that they can reorder - when they select each of these saved elements they will occupy the central panel. 


    * Users will be able to move between the search and interactive tree mapping tooling and the saved tree objects with a simple selection option. To be explicit here there will be 2 modes to the tool: the mapping view and the saved mapping view


    * Each resource will also include a way to open a new tab to the appropriate registry entry. 




## Aims for the display

We are looking to create an elegant design that is easy to understand and navigate.


* Some elements we will look to include:


    * There will be a simple search menu at the top of the screen. 


    * There will be 2 modes the mapping view and the saved mapping view. There will be a subtle colour change between the 2 views, the saved mapping tool with have a bolder styling. 


    * the elements of each map will be like bubble and will pop into and out of view when they are added or removed. 


    * Visual colouring will be like the vscode abyss theme. 


    * the saved mapping view will include saved mappings on the left hand side in a scrollable bar. These will be renameable by the user. 


    * In saved mappings the user will be able to adjust the position of bubbles in the view windown. 


    * The view screen will be zoomable and users will be able to click and drag to pan the view. 




## Limitations


* There are a few things we want to be able to achieve with this tool:


    * This is to created as a docker image that can run locally. 


    * As well as as running locally we also want this to be able to run in a aws ecs and postgres rds. As such this will ultimately be a tool that will be able to run in a browser


    * 



## Requirements


* When creating this tool there are a few elements that need to be adhered to:


    * The code needs to be clean and readble - comments are to be minimised if a clear naming covention can be used instead. 


    * The latest best practices will be used for the chosen coding languages used, focusing on performance and security. 


    * There will need to be accompanying documentation on how to use and start the tool. This is to be kept as concise as is practical, the goal will be to enable anyone unfamiliar with the project to run it without prior knowledge. 


    * Creation of the tool will be broken into stages at your discretion, however you will create an initial task list for required steps and then you will wait for authorisation to go ahead. If the task list needs to be altered during this you will again ask for confirmation. 


    * When stages have been confirmed you will estimate a time frame and share this. 