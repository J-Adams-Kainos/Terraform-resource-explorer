# Plan for further updates


## Instructions on resolving implementing following features. 


For all following features please work on them one at a time, each feature under a heading is treated as it's own request. If a later change involves improving a previous request this is permissable. You will wait for 


When beginning a listed task you will evaluate different methods to achieve the goal and provide a high level oversight of these methods with a listing of strengths and weaknesses of those options. You will then ask for a choice made before progressing. 


## Branches on shared nodes


At the moment we creat one single tree from root node going up and down. 


We want to be able to make it so that users can creat branches from the central trunk when needed. 


For example now we have aws_vpc > aws_internet_gateway from here want want to be able to diverge to explore both aws_nat_gateway and aws_route


The goal is to allow users to be able to create more realistic structures of what they are interested in building. 



## Clear visual mode


We want to be able to have a "Clean Mode" which will hide previous categories further up the tree and only display the selected nodes.  


The goal is to remove clutter when needed for a cleaner viewing experience.



## Export Map image


Users may want to export the total terraform map they have created as an image. They will only want key chosen branches and the resources will be visible but sub categories will be not. 


Users will want to see a preview before they are being asked to download the image. 


Users will want the option to be able to choose the layout for the branches before exporting. 